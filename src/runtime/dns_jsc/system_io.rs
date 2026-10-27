//! What `bun_dns_resolver` asks of the operating system, answered with the event loop's polls.

use core::net::{IpAddr, SocketAddr};

use bun_collections::ArrayHashMap;
use bun_core::env_var;
use bun_dns_resolver::io::{
    EnvVar, FileError, FileIdentity, Io, IoError, Opened, Settings, Socket, Transport,
};
#[cfg(not(windows))]
use bun_io as Async;
#[cfg(not(windows))]
use bun_io::FilePoll;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::net::Address;
use bun_sys::{self as sys, Fd, socket};

use super::Resolver;
#[cfg(windows)]
use super::UvDnsPoll;
#[cfg(not(windows))]
use super::dns_body::js_event_loop_ctx;

#[cfg(windows)]
type PollType = UvDnsPoll;
#[cfg(not(windows))]
type PollType = FilePoll;

pub(crate) struct SystemIo {
    /// BACKREF: the owner the polls report to. It owns the channel that owns this.
    resolver: *mut Resolver,
    vm: bun_ptr::BackRef<VirtualMachine>,
    polls: ArrayHashMap<Fd, *mut PollType>,
}

pub(super) fn socket_of(fd: Fd) -> Socket {
    Socket(fd.0 as u64)
}

fn fd_of(socket: Socket) -> Fd {
    Fd(socket.0 as _)
}

fn io_error(error: &sys::Error) -> IoError {
    match error.get_errno() {
        sys::E::EAGAIN | sys::E::EINPROGRESS => IoError::WouldBlock,
        _ => IoError::Failed,
    }
}

/// A connection that is still being made is no failure.
fn connect(fd: Fd, address: &Address) -> sys::Maybe<()> {
    match socket::connect(fd, address) {
        Err(error) if io_error(&error) == IoError::Failed => Err(error),
        _ => Ok(()),
    }
}

impl SystemIo {
    pub(crate) fn new(resolver: *mut Resolver, vm: &VirtualMachine) -> Self {
        // SAFETY: idempotent (`uv_once`). libuv otherwise starts Winsock lazily.
        #[cfg(windows)]
        unsafe {
            bun_libuv_sys::uv__winsock_ensure()
        };
        Self {
            resolver,
            vm: bun_ptr::BackRef::new(vm),
            polls: ArrayHashMap::new(),
        }
    }

    fn configure(
        fd: Fd,
        transport: Transport,
        server: &Address,
        local: Option<IpAddr>,
    ) -> sys::Maybe<bool> {
        if transport == Transport::Tcp {
            // One query, then a wait for its answer: nothing to batch.
            socket::set_option(fd, socket::IPPROTO_TCP, socket::TCP_NODELAY, 1)?;
        }
        // Off by default everywhere else.
        #[cfg(windows)]
        if server.as_in6().is_some() {
            use bun_sys::windows::ws2_32::{IPPROTO_IPV6, IPV6_V6ONLY};
            let _ = socket::set_option(fd, IPPROTO_IPV6, IPV6_V6ONLY, 0);
        }
        if let Some(local) = local {
            // The port is chosen at connect(2), when the four-tuple is known, so more of them can be in use.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            if transport == Transport::Tcp {
                let _ = socket::set_option(fd, libc::SOL_IP, libc::IP_BIND_ADDRESS_NO_PORT, 1);
            }
            socket::bind(fd, &Address::from_ip(local, 0))?;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let fast_open = transport == Transport::Tcp
            && socket::set_option(fd, libc::IPPROTO_TCP, libc::TCP_FASTOPEN_CONNECT, 1).is_ok();
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let fast_open = false;
        connect(fd, server)?;
        Ok(fast_open)
    }
}

impl Io for SystemIo {
    fn open(
        &mut self,
        transport: Transport,
        server: SocketAddr,
        local: Option<IpAddr>,
    ) -> Result<Opened, IoError> {
        let server = Address::from(server);
        let kind = match transport {
            Transport::Udp => socket::Kind::Datagram,
            Transport::Tcp => socket::Kind::Stream,
        };
        let fd = socket::open(&server, kind).map_err(|_| IoError::Failed)?;
        match Self::configure(fd, transport, &server, local) {
            Ok(fast_open) => Ok(Opened {
                socket: socket_of(fd),
                fast_open,
            }),
            Err(_) => {
                socket::close(fd);
                Err(IoError::Failed)
            }
        }
    }

    fn send(&mut self, socket: Socket, data: &[u8]) -> Result<usize, IoError> {
        match sys::send_non_block(fd_of(socket), data) {
            Ok(0) => Err(IoError::Failed),
            Ok(sent) => Ok(sent),
            Err(error) => Err(io_error(&error)),
        }
    }

    fn recv_from(
        &mut self,
        socket: Socket,
        buffer: &mut [u8],
    ) -> Result<(usize, SocketAddr), IoError> {
        let (received, from) =
            socket::recv_from(fd_of(socket), buffer).map_err(|error| io_error(&error))?;
        Ok((received, from.to_socket_addr().ok_or(IoError::Failed)?))
    }

    fn recv(&mut self, socket: Socket, buffer: &mut [u8]) -> Result<usize, IoError> {
        match sys::recv_non_block(fd_of(socket), buffer) {
            Ok(0) => Err(IoError::Failed),
            Ok(received) => Ok(received),
            Err(error) => Err(io_error(&error)),
        }
    }

    #[cfg(not(windows))]
    fn watch(&mut self, socket: Socket, writable: bool) {
        let fd = fd_of(socket);
        let owner = Async::Owner::new(
            Async::posix_event_loop::poll_tag::DNS_RESOLVER,
            self.resolver.cast::<()>(),
        );
        // SAFETY: `event_loop_handle` is set once the VM is initialized and lives as long as it.
        let loop_ = unsafe { &mut *self.vm.event_loop_handle.unwrap() };
        let poll = *self
            .polls
            .entry(fd)
            .or_insert_with(|| FilePoll::init(js_event_loop_ctx(), fd, Default::default(), owner));
        // SAFETY: a live slot of the poll hive, freed only by `close`; JS thread.
        let poll = unsafe { &mut *poll };

        // `FilePoll` cannot drop one direction, and a writable one left armed spins once the socket connects.
        if poll.flags.contains(Async::PollFlag::PollWritable) && !writable {
            let _ = poll.unregister(loop_, false);
            let _ = poll.register(loop_, Async::PollKind::Readable, false);
            return;
        }
        if !poll.flags.contains(Async::PollFlag::PollReadable) {
            let _ = poll.register(loop_, Async::PollKind::Readable, false);
        }
        if writable && !poll.flags.contains(Async::PollFlag::PollWritable) {
            let _ = poll.register(loop_, Async::PollKind::Writable, false);
        }
    }

    #[cfg(windows)]
    fn watch(&mut self, socket: Socket, writable: bool) {
        use bun_sys::windows::libuv as uv;
        let fd = fd_of(socket);
        let poll: *mut UvDnsPoll = match self.polls.get(&fd) {
            Some(poll) => *poll,
            None => {
                let poll = UvDnsPoll::new(self.resolver, fd);
                // SAFETY: the live loop of this thread, and a fresh allocation with a zeroed `uv_poll_t`.
                if unsafe {
                    uv::uv_poll_init_socket(self.vm.uv_loop(), &mut (*poll).poll, fd.native() as _)
                } < 0
                {
                    UvDnsPoll::destroy(poll);
                    return;
                }
                bun_core::handle_oom(self.polls.put(fd, poll));
                poll
            }
        };
        let events = uv::UV_READABLE | (if writable { uv::UV_WRITABLE } else { 0 });
        // SAFETY: `poll` is the live entry of the map.
        if unsafe { uv::uv_poll_start(&mut (*poll).poll, events, Some(Resolver::on_dns_poll_uv)) }
            < 0
        {
            let _ = self.polls.swap_remove(&fd);
            // SAFETY: the handle is initialized, so `uv_close` is how it goes; `on_close_uv` frees it.
            unsafe {
                uv::uv_close(
                    core::ptr::from_mut(&mut (*poll).poll).cast(),
                    Some(Resolver::on_close_uv),
                )
            };
        }
    }

    fn close(&mut self, socket: Socket) {
        let fd = fd_of(socket);
        if let Some(poll) = self.polls.remove(&fd) {
            // SAFETY: the live poll `watch` made for this socket, which nothing refers to any more.
            #[cfg(not(windows))]
            unsafe {
                (*poll).deinit_with_vm(js_event_loop_ctx())
            };
            // SAFETY: libuv owns the handle until `on_close_uv` frees the allocation.
            #[cfg(windows)]
            unsafe {
                bun_sys::windows::libuv::uv_close(
                    core::ptr::from_mut(&mut (*poll).poll).cast(),
                    Some(Resolver::on_close_uv),
                )
            };
        }
        socket::close(fd);
    }

    fn random(&mut self, bytes: &mut [u8]) {
        bun_boringssl_sys::rand_bytes(bytes);
    }

    fn unix_time(&mut self) -> i64 {
        bun_core::time::timestamp()
    }

    fn read_file(&mut self, path: &[u8]) -> Result<Vec<u8>, FileError> {
        sys::File::read_from(Fd::cwd(), path).map_err(|error| match error.get_errno() {
            sys::E::ENOENT | sys::E::ESRCH => FileError::NotFound,
            _ => FileError::Other,
        })
    }

    fn file_identity(&mut self, path: &[u8]) -> Option<FileIdentity> {
        let stat = sys::stat(&bun_core::ZBox::from_bytes(path)).ok()?;
        let stat = sys::PosixStat::init(&stat);
        Some(FileIdentity {
            modified_at: stat.mtime().sec,
            size: stat.size,
            inode: stat.ino,
            device: stat.dev,
        })
    }

    fn env(&mut self, variable: EnvVar) -> Option<Vec<u8>> {
        match variable {
            EnvVar::LocalDomain => env_var::LOCALDOMAIN.get(),
            EnvVar::ResOptions => env_var::RES_OPTIONS.get(),
            EnvVar::HostAliases => env_var::HOSTALIASES.get(),
        }
        .map(<[u8]>::to_vec)
    }

    fn settings(&mut self) -> Settings {
        super::system_settings::read()
    }

    #[cfg(not(windows))]
    fn hostname(&mut self) -> Option<Vec<u8>> {
        let mut buffer = [0u8; 256];
        sys::posix::gethostname(&mut buffer).ok()?;
        let len = bun_core::strings::index_of_char_usize(&buffer, 0)?;
        Some(buffer[..len].to_vec())
    }

    #[cfg(windows)]
    fn hostname(&mut self) -> Option<Vec<u8>> {
        let mut buffer = [0u16; 256];
        // SAFETY: the buffer has the units the function may write, and Winsock was started in `new`.
        let status =
            unsafe { sys::windows::GetHostNameW(buffer.as_mut_ptr(), buffer.len() as i32) };
        let len = bun_core::strings::index_of_scalar(&buffer, 0)?;
        (status == 0).then(|| bun_core::strings::to_utf8_alloc(&buffer[..len]))
    }

    #[cfg(not(windows))]
    fn etc_path(&mut self, name: &str) -> Option<Vec<u8>> {
        Some(format!("/etc/{name}").into_bytes())
    }

    #[cfg(windows)]
    fn etc_path(&mut self, name: &str) -> Option<Vec<u8>> {
        let mut path = super::system_settings::etc_directory()?;
        path.push(b'\\');
        path.extend_from_slice(name.as_bytes());
        Some(path)
    }

    #[cfg(windows)]
    fn interface_index(&mut self, name: &[u8]) -> Option<u32> {
        super::system_settings::interface_index(name)
    }

    #[cfg(windows)]
    fn has_interface(&mut self, index: u32) -> bool {
        super::system_settings::has_interface(index)
    }

    #[cfg(windows)]
    fn loopback_addresses(&mut self) -> Option<Vec<IpAddr>> {
        super::system_settings::loopback_addresses()
    }

    #[cfg(not(windows))]
    fn interface_index(&mut self, name: &[u8]) -> Option<u32> {
        let name = bun_core::ZBox::from_bytes(name);
        // SAFETY: `name` is NUL-terminated.
        Some(unsafe { libc::if_nametoindex(name.as_ptr().cast()) }).filter(|&index| index != 0)
    }

    #[cfg(not(windows))]
    fn has_interface(&mut self, index: u32) -> bool {
        let mut name = [0; libc::IF_NAMESIZE];
        // SAFETY: the buffer is the `IF_NAMESIZE` bytes the function may write.
        !unsafe { libc::if_indextoname(index, name.as_mut_ptr()) }.is_null()
    }

    fn source_address(&mut self, destination: SocketAddr) -> Result<Option<IpAddr>, IoError> {
        let destination = Address::from(destination);
        let fd = match socket::open(&destination, socket::Kind::Datagram) {
            Ok(fd) => fd,
            Err(error) if error.get_errno() == sys::E::EAFNOSUPPORT => return Ok(None),
            Err(_) => return Err(IoError::Failed),
        };
        let _close = scopeguard::guard(fd, socket::close);
        if connect(fd, &destination).is_err() {
            return Ok(None);
        }
        let local = socket::local_address(fd).map_err(|_| IoError::Failed)?;
        Ok(local.to_socket_addr().map(|address| address.ip()))
    }

    #[cfg(not(windows))]
    fn loopback_addresses(&mut self) -> Option<Vec<IpAddr>> {
        None
    }
}
