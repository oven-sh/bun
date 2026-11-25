//! What `bun_dns_client` runs on.

use core::ffi::c_int;
use core::net::{IpAddr, SocketAddr};
use core::time::Duration;
use std::time::SystemTime;

use bun_core::{Fd, Timespec, TimespecMockMode, ZStr, env_var};
use bun_dns_client::{
    DEFAULT_PORT, FileStamp, Route, SocketError, SocketId, System, Transport, Variable,
};
use bun_sys::net::{self, Address};
use bun_sys::{E, Maybe, PosixStat};

use crate::sock;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

/// The event loop's watch over a socket.
pub trait Poll: Sized {
    type Owner;

    fn open(owner: &Self::Owner, socket: Fd) -> Option<Self>;

    /// As [`bun_dns_client::Socket::watch`].
    fn watch(&self, writable: bool);
}

pub fn socket_id(socket: Fd) -> SocketId {
    socket.native() as SocketId
}

pub struct Socket<P> {
    /// Has to go before `socket` closes.
    poll: P,
    socket: net::Socket,
    transport: Transport,
    is_connecting: bool,
}

fn socket_error(error: &bun_sys::Error) -> SocketError {
    match error.get_errno() {
        E::EAGAIN | E::EINPROGRESS | E::EINTR => SocketError::WouldBlock,
        _ => SocketError::Failed,
    }
}

impl<P: Poll> bun_dns_client::Socket for Socket<P> {
    fn id(&self) -> SocketId {
        socket_id(self.socket.fd())
    }

    fn is_connecting(&self) -> bool {
        self.is_connecting
    }

    fn send(&mut self, data: &[u8]) -> Result<usize, SocketError> {
        bun_sys::send_non_block(self.socket.fd(), data).map_err(|error| match error.get_errno() {
            // The queue of the interface is full.
            E::ENOBUFS if self.transport == Transport::Udp => SocketError::WouldBlock,
            _ => socket_error(&error),
        })
    }

    fn receive(&mut self, buffer: &mut Vec<u8>) -> Result<Option<SocketAddr>, SocketError> {
        let (fd, len) = (self.socket.fd(), buffer.len());
        let sender = bun_core::vec::append_with(buffer, usize::MAX, |it| net::recvfrom_buf(fd, it))
            .map_err(|error| socket_error(&error))?;
        if self.transport == Transport::Tcp && buffer.len() == len {
            return Err(SocketError::Failed);
        }
        Ok(sender.to_socket_addr())
    }

    fn watch(&mut self, writable: bool) {
        self.poll.watch(writable);
    }
}

fn open(address: &Address, kind: c_int) -> Maybe<net::Socket> {
    let socket = net::Socket::new(address.family(), kind)?;
    // By default, it cannot reach an IPv4-mapped address.
    #[cfg(any(windows, target_os = "freebsd"))]
    if address.family() == sock::AF_INET6 {
        let _ = net::setsockopt_int(socket.fd(), sock::IPPROTO_IPV6, sock::IPV6_V6ONLY, 0);
    }
    Ok(socket)
}

/// What `connect` says when it takes time.
const IN_PROGRESS: E = if cfg!(windows) {
    E::EAGAIN
} else {
    E::EINPROGRESS
};

pub struct Os<P: Poll> {
    poll_owner: P::Owner,
    /// Asking for many takes as long as asking for one. They last no longer than to the next socket.
    randoms: core::array::IntoIter<[u8; 2], 64>,
}

impl<P: Poll> Os<P> {
    pub fn new(poll_owner: P::Owner) -> Self {
        Self {
            poll_owner,
            randoms: Default::default(),
        }
    }

    fn renew_randoms(&mut self) -> Option<()> {
        let mut randoms = [[0; 2]; _];
        bun_core::util::os_entropy(randoms.as_flattened_mut())
            .then(|| self.randoms = randoms.into_iter())
    }
}

impl<P: Poll> System for Os<P> {
    type Socket = Socket<P>;

    /// Timers are too coarse there to send few at a time.
    #[cfg(windows)]
    const DATAGRAMS_HELD: usize = 512;

    fn now(&self) -> Duration {
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        Duration::new(now.sec as u64, now.nsec as u32)
    }

    fn wall_clock(&self) -> i64 {
        // `bun_core::time::timestamp()` divides an `i128`, and each cache hit gets here.
        let since_epoch = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH);
        since_epoch.map_or(0, |it| it.as_secs() as i64)
    }

    fn random(&mut self) -> Option<u16> {
        if self.randoms.len() == 0 {
            self.renew_randoms()?;
        }
        self.randoms.next().map(u16::from_ne_bytes)
    }

    fn connect(
        &mut self,
        transport: Transport,
        server: SocketAddr,
        local: Option<IpAddr>,
    ) -> Option<Socket<P>> {
        // First: it may take a descriptor, which it needs only once.
        self.renew_randoms()?;
        let mut address = Address::from_ip(server.ip(), server.port());
        if let SocketAddr::V6(server) = server {
            address.set_scope_id(server.scope_id());
        }
        let kind = match transport {
            Transport::Udp => sock::SOCK_DGRAM,
            Transport::Tcp => sock::SOCK_STREAM,
        };
        let socket = open(&address, kind).ok()?;
        let fd = socket.fd();
        if transport == Transport::Udp {
            #[cfg(windows)]
            let _ = net::setsockopt_int(fd, sock::SOL_SOCKET, sock::SO_RANDOMIZE_PORT, 1);
            let _ = net::setsockopt_int(fd, sock::SOL_SOCKET, sock::SO_RCVBUF, 1 << 20);
        }
        if transport == Transport::Tcp {
            net::setsockopt_int(fd, sock::IPPROTO_TCP, sock::TCP_NODELAY, 1).ok()?;
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                let _ = net::setsockopt_int(fd, libc::IPPROTO_TCP, libc::TCP_FASTOPEN_CONNECT, 1);
                if local.is_some() {
                    let _ = net::setsockopt_int(fd, libc::SOL_IP, libc::IP_BIND_ADDRESS_NO_PORT, 1);
                }
            }
        }
        if let Some(local) = local {
            net::bind(fd, Address::from_ip(local, 0).as_bytes()).ok()?;
        }
        let is_connecting = match net::connect(fd, address.as_bytes()).map_err(|it| it.get_errno())
        {
            Ok(()) => false,
            Err(IN_PROGRESS | E::EINTR) if transport == Transport::Tcp => true,
            Err(_) => return None,
        };
        Some(Socket {
            poll: P::open(&self.poll_owner, fd)?,
            socket,
            transport,
            is_connecting,
        })
    }

    fn route(&mut self, destination: IpAddr) -> Route {
        let address = Address::from_ip(destination, DEFAULT_PORT);
        let socket = match open(&address, sock::SOCK_DGRAM) {
            Ok(socket) => socket,
            Err(error) if error.get_errno() == E::EAFNOSUPPORT => return Route::Unreachable,
            Err(_) => return Route::Unknown,
        };
        if net::connect(socket.fd(), address.as_bytes()).is_err() {
            return Route::Unreachable;
        }
        let source = net::getsockname(socket.fd()).ok();
        let source = source.and_then(|source| source.to_socket_addr());
        source.map_or(Route::Unknown, |source| Route::From(source.ip()))
    }

    #[cfg(any(target_os = "macos", windows))]
    fn configure(&mut self, config: &mut bun_dns_client::Config) {
        #[cfg(target_os = "macos")]
        macos::configure(config);
        #[cfg(windows)]
        windows::configure(config);
    }

    /// Android 8 and later do not tell.
    #[cfg(target_os = "android")]
    fn configure(&mut self, config: &mut bun_dns_client::Config) {
        for digit in b'1'..=b'8' {
            let name = [b'n', b'e', b't', b'.', b'd', b'n', b's', digit, 0];
            let mut value = [0u8; libc::PROP_VALUE_MAX as usize];
            // SAFETY: `name` is NUL-terminated, and it writes at most `PROP_VALUE_MAX` bytes.
            let len = unsafe {
                libc::__system_property_get(name.as_ptr().cast(), value.as_mut_ptr().cast())
            };
            if len < 1 {
                break;
            }
            config.add_servers(bun_core::slice_to_nul(&value), self);
        }
    }

    /// Termux has none of these files. What runs Bun there preloads an `fopen` that finds them elsewhere.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn read_file(&self, path: &[u8]) -> Option<Vec<u8>> {
        let path = bun_core::ZBox::from_bytes(path);
        let stat = bun_sys::stat(&path).ok();
        // Opening a FIFO waits for a writer.
        if stat.is_some_and(|it| !bun_sys::is_regular_file(it.st_mode)) {
            return None;
        }
        let room = 4096 + stat.map_or(0, |it| it.st_size as usize);
        let mut text = Vec::new();
        // SAFETY: both strings are NUL-terminated, `file` is open until `fclose`, and `fread` returns how much it filled.
        unsafe {
            let file = libc::fopen(path.as_ptr(), c"re".as_ptr());
            if file.is_null() {
                return None;
            }
            while libc::feof(file) == 0 && libc::ferror(file) == 0 {
                bun_core::vec::fill_spare(&mut text, room, |spare| {
                    (
                        libc::fread(spare.as_mut_ptr().cast(), 1, spare.len(), file),
                        (),
                    )
                });
            }
            let is_whole = libc::ferror(file) == 0;
            libc::fclose(file);
            is_whole.then_some(text)
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    fn read_file(&self, path: &[u8]) -> Option<Vec<u8>> {
        use bun_sys::{File, FileKind, O};
        // Opening a FIFO waits for a writer.
        let flags = O::RDONLY | if cfg!(unix) { O::NONBLOCK } else { 0 };
        let file = File::openat(Fd::cwd(), path, flags, 0).ok()?;
        (file.kind().ok()? == FileKind::File).then(|| file.read_to_end().ok())?
    }

    fn stamp(&self, path: &ZStr) -> Option<FileStamp> {
        let stat = PosixStat::init(&bun_sys::stat(path).ok()?);
        Some(FileStamp {
            modified: stat.mtim.sec,
            size: stat.size,
            inode: stat.ino,
            device: stat.dev,
        })
    }

    fn variable(&self, variable: Variable) -> Option<&[u8]> {
        match variable {
            Variable::HostAliases => env_var::HOSTALIASES.get(),
            Variable::LocalDomain => env_var::LOCALDOMAIN.get(),
            Variable::ResOptions => env_var::RES_OPTIONS.get(),
        }
    }

    #[cfg(unix)]
    fn hostname(&self) -> Option<Vec<u8>> {
        let mut name = [0; 256];
        bun_sys::posix::gethostname(&mut name).ok()?;
        Some(bun_core::slice_to_nul(&name).to_vec())
    }

    #[cfg(windows)]
    fn hostname(&self) -> Option<Vec<u8>> {
        bun_sys::windows::GetHostNameW(&mut [0; 256]).map(bun_core::strings::to_utf8_alloc)
    }

    #[cfg(unix)]
    fn interface_index(&self, name: &[u8]) -> Option<u32> {
        let mut buffer = [0; libc::IF_NAMESIZE];
        let index = net::if_nametoindex(bun_core::strings::copy_z(&mut buffer, name)?);
        (index != 0).then_some(index)
    }

    #[cfg(windows)]
    fn interface_index(&self, _: &[u8]) -> Option<u32> {
        None
    }

    fn service_name(&self, port: u16) -> Option<Box<[u8]>> {
        #[cfg(windows)]
        bun_sys::windows::libuv::uv__winsock_ensure();
        let address = Address::from_ip(IpAddr::from([0; 4]), port);
        let (address, mut name) = (address.as_bytes(), [0u8; 64]);
        // SAFETY: each buffer is passed with its length. The name of the host is not asked for.
        let status = unsafe {
            sock::getnameinfo(
                address.as_ptr().cast(),
                address.len() as _,
                core::ptr::null_mut(),
                0,
                name.as_mut_ptr().cast(),
                name.len() as _,
                0,
            )
        };
        (status == 0).then(|| bun_core::slice_to_nul(&name).into())
    }
}
