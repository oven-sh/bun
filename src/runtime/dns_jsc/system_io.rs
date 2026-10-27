//! What `bun_dns_resolver` asks of the operating system, answered with the event loop's polls.

use core::net::{IpAddr, SocketAddr};

use bun_collections::ArrayHashMap;
use bun_core::env_var;
use bun_dns_resolver::io::{FileError, Io, IoError, Opened, Settings, Transport, Variable};
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

fn io_error(error: sys::Error) -> IoError {
    match error.get_errno() {
        sys::E::EAGAIN | sys::E::EINPROGRESS => IoError::WouldBlock,
        _ => IoError::Failed,
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
        match socket::connect(fd, server).map_err(io_error) {
            Ok(()) | Err(IoError::WouldBlock) => Ok(fast_open),
            Err(IoError::Failed) => Err(sys::Error::from_code(
                sys::E::ECONNREFUSED,
                sys::Tag::connect,
            )),
        }
    }
}

impl Io for SystemIo {
    type Socket = Fd;

    fn open(
        &mut self,
        transport: Transport,
        server: SocketAddr,
        local: Option<IpAddr>,
    ) -> Result<Opened<Fd>, IoError> {
        let server = Address::from(server);
        let kind = match transport {
            Transport::Udp => socket::Kind::Datagram,
            Transport::Tcp => socket::Kind::Stream,
        };
        let fd = socket::open(&server, kind).map_err(|_| IoError::Failed)?;
        match Self::configure(fd, transport, &server, local) {
            Ok(fast_open) => Ok(Opened {
                socket: fd,
                fast_open,
            }),
            Err(_) => {
                socket::close(fd);
                Err(IoError::Failed)
            }
        }
    }

    fn send(&mut self, socket: Fd, data: &[u8]) -> Result<usize, IoError> {
        match sys::send_non_block(socket, data) {
            Ok(0) => Err(IoError::Failed),
            Ok(sent) => Ok(sent),
            Err(error) => Err(io_error(error)),
        }
    }

    fn recv_from(&mut self, socket: Fd, buffer: &mut [u8]) -> Result<(usize, SocketAddr), IoError> {
        let (received, from) = socket::recv_from(socket, buffer).map_err(io_error)?;
        Ok((received, from.to_socket_addr().ok_or(IoError::Failed)?))
    }

    fn recv(&mut self, socket: Fd, buffer: &mut [u8]) -> Result<usize, IoError> {
        match sys::recv_non_block(socket, buffer) {
            Ok(0) => Err(IoError::Failed),
            Ok(received) => Ok(received),
            Err(error) => Err(io_error(error)),
        }
    }

    #[cfg(not(windows))]
    fn watch(&mut self, socket: Fd, readable: bool, writable: bool) {
        let ctx = Async::posix_event_loop::get_vm_ctx(Async::AllocatorType::Js);
        let owner = Async::Owner::new(
            Async::posix_event_loop::poll_tag::DNS_RESOLVER,
            self.resolver.cast::<()>(),
        );
        // SAFETY: `event_loop_handle` is set once the VM is initialized and lives as long as it.
        let loop_ = unsafe { &mut *self.vm.event_loop_handle.unwrap() };
        let poll = *self
            .polls
            .entry(socket)
            .or_insert_with(|| FilePoll::init(ctx, socket, Default::default(), owner));
        // SAFETY: a live slot of the poll hive, freed only by `close`; JS thread.
        let poll = unsafe { &mut *poll };

        let have_readable = poll.flags.contains(Async::PollFlag::PollReadable);
        let have_writable = poll.flags.contains(Async::PollFlag::PollWritable);
        // `FilePoll` cannot drop one direction, and a writable one left armed spins once the socket connects.
        if (have_readable && !readable) || (have_writable && !writable) {
            let _ = poll.unregister(loop_, false);
            if readable {
                let _ = poll.register(loop_, Async::PollKind::Readable, false);
            }
            if writable {
                let _ = poll.register(loop_, Async::PollKind::Writable, false);
            }
        } else {
            if readable && !have_readable {
                let _ = poll.register(loop_, Async::PollKind::Readable, false);
            }
            if writable && !have_writable {
                let _ = poll.register(loop_, Async::PollKind::Writable, false);
            }
        }
    }

    #[cfg(windows)]
    fn watch(&mut self, socket: Fd, readable: bool, writable: bool) {
        use bun_sys::windows::libuv as uv;
        let poll: *mut UvDnsPoll = match self.polls.get(&socket) {
            Some(poll) => *poll,
            None => {
                let poll = UvDnsPoll::new(self.resolver, socket);
                // SAFETY: the live loop of this thread, and a fresh allocation with a zeroed `uv_poll_t`.
                if unsafe {
                    uv::uv_poll_init_socket(
                        self.vm.uv_loop(),
                        &mut (*poll).poll,
                        socket.native() as _,
                    )
                } < 0
                {
                    UvDnsPoll::destroy(poll);
                    return;
                }
                bun_core::handle_oom(self.polls.put(socket, poll));
                poll
            }
        };
        let events = (if readable { uv::UV_READABLE } else { 0 })
            | (if writable { uv::UV_WRITABLE } else { 0 });
        // SAFETY: `poll` is the live entry of the map.
        if unsafe { uv::uv_poll_start(&mut (*poll).poll, events, Some(Resolver::on_dns_poll_uv)) }
            < 0
        {
            let _ = self.polls.swap_remove(&socket);
            // SAFETY: the handle is initialized, so `uv_close` is how it goes; `on_close_uv` frees it.
            unsafe {
                uv::uv_close(
                    core::ptr::from_mut(&mut (*poll).poll).cast(),
                    Some(Resolver::on_close_uv),
                )
            };
        }
    }

    fn close(&mut self, socket: Fd) {
        if let Some(poll) = self.polls.remove(&socket) {
            // SAFETY: the live poll `watch` made for this socket, which nothing refers to any more.
            #[cfg(not(windows))]
            unsafe {
                (*poll).deinit_with_vm(Async::posix_event_loop::get_vm_ctx(
                    Async::AllocatorType::Js,
                ))
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
        socket::close(socket);
    }

    fn random(&mut self, bytes: &mut [u8]) {
        bun_boringssl_sys::rand_bytes(bytes);
    }

    fn unix_time(&mut self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs() as i64)
    }

    fn read_file(&mut self, path: &[u8]) -> Result<Vec<u8>, FileError> {
        sys::File::read_from(Fd::cwd(), path).map_err(|error| match error.get_errno() {
            sys::E::ENOENT | sys::E::ESRCH => FileError::NotFound,
            _ => FileError::Other,
        })
    }

    fn modified_time(&mut self, path: &[u8]) -> Option<i64> {
        let stat = sys::stat(&bun_core::ZBox::from_bytes(path)).ok()?;
        Some(sys::PosixStat::init(&stat).mtime().sec)
    }

    fn env(&mut self, variable: Variable) -> Option<Vec<u8>> {
        match variable {
            Variable::LocalDomain => env_var::LOCALDOMAIN.get(),
            Variable::ResOptions => env_var::RES_OPTIONS.get(),
            Variable::HostAliases => env_var::HOSTALIASES.get(),
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
        let len = buffer.iter().position(|&unit| unit == 0)?;
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
        if let Err(IoError::Failed) = socket::connect(fd, &destination).map_err(io_error) {
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
