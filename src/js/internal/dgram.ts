// Mirrors the module shape of Node's lib/internal/dgram.js. node:dgram keeps
// its per-socket state under kStateSymbol, and _createSocketHandle/UDP back
// cluster-shared sockets and the udp_wrap internal binding that vendored Node
// tests reach through bun:internal-for-testing's exposedInternals.

const newSocketFd = $newRustFunction("udp_socket.rs", "jsDgramNewSocketFd", 2);
const bindFd = $newRustFunction("udp_socket.rs", "jsDgramBindFd", 4);
const getSockNameFd = $newRustFunction("udp_socket.rs", "jsDgramGetSockNameFd", 1);
const guessHandleTypeFd = $newRustFunction("udp_socket.rs", "jsDgramGuessHandleType", 1);
const adoptFd = $newRustFunction("udp_socket.rs", "jsDgramAdoptFd", 1);
const closeFd = $newRustFunction("udp_socket.rs", "jsDgramCloseFd", 1);

const kStateSymbol = Symbol("state symbol");

// libuv-style error codes for the raw-descriptor surface. This surface is
// POSIX-only (Windows reports ENOTSUP, like Node's cluster does for shared
// dgram handles), so the POSIX values are the libuv values.
const UV_EBADF = -9;
const UV_EINVAL = -22;

function uvErrno(err, fallback) {
  return typeof err?.errno === "number" && err.errno < 0 ? err.errno : fallback;
}

// A libuv-style UDP handle over a raw datagram descriptor: created/bound (or
// adopted) but never reading. Live node:dgram sockets read through
// Bun.udpSocket; this wrap exists so the cluster primary can hold a shared,
// non-reading handle and so `// Flags: --expose-internals` tests can exercise
// internalBinding('udp_wrap').UDP. Adopting a wrap's fd into a reading socket
// transfers ownership of the descriptor — don't close the wrap afterwards.
class UDP {
  // The descriptor is only reachable through open()/bind()/close() so a stray
  // write can't redirect close() at an unrelated descriptor.
  #fd = -1;

  get fd() {
    return this.#fd;
  }

  bind(address, port, flags) {
    return this.#bind(address, port, flags, false);
  }

  bind6(address, port, flags) {
    return this.#bind(address, port, flags, true);
  }

  #bind(address, port, flags, ipv6) {
    try {
      if (this.#fd < 0) {
        this.#fd = newSocketFd(ipv6, false);
      }
      bindFd(this.#fd, address || (ipv6 ? "::" : "0.0.0.0"), port || 0, flags || 0);
      return 0;
    } catch (err) {
      return uvErrno(err, UV_EINVAL);
    }
  }

  open(fd) {
    if (guessHandleType(fd) !== "UDP") {
      return UV_EINVAL;
    }
    // The wrap owns externally created descriptors (IPC-received or
    // user-provided), so getsockname()/close() must accept them.
    try {
      adoptFd(fd);
    } catch (err) {
      return uvErrno(err, UV_EINVAL);
    }
    this.#fd = fd;
    return 0;
  }

  getsockname(out) {
    if (this.#fd < 0) {
      return UV_EBADF;
    }
    try {
      const { address, port, family } = getSockNameFd(this.#fd);
      out.address = address;
      out.port = port;
      out.family = family;
      return 0;
    } catch (err) {
      return uvErrno(err, UV_EBADF);
    }
  }

  close(cb) {
    if (this.#fd >= 0) {
      closeFd(this.#fd);
      this.#fd = -1;
    }
    // Node's HandleWrap runs the close callback once the handle is closed;
    // cluster's disconnect accounting (checkWaitingCount) depends on it.
    if (typeof cb === "function") process.nextTick(cb);
    return 0;
  }

  ref() {}
  unref() {}
  hasRef() {
    return true;
  }
}

function isInt32(value) {
  return value === (value | 0);
}

function _createSocketHandle(address, port, addressType, fd, flags) {
  const handle = new UDP();
  let err;

  if (typeof fd === "number" && isInt32(fd) && fd > 0) {
    if (guessHandleType(fd) !== "UDP") {
      err = UV_EINVAL;
    } else {
      err = handle.open(fd);
    }
  } else if (port || address) {
    err = addressType === "udp6" ? handle.bind6(address, port || 0, flags) : handle.bind(address, port || 0, flags);
  }

  if (err) {
    handle.close();
    return err;
  }

  return handle;
}

function guessHandleType(fd) {
  if (typeof fd !== "number" || !isInt32(fd) || fd < 0) {
    return "UNKNOWN";
  }
  return guessHandleTypeFd(fd);
}

export default {
  kStateSymbol,
  UDP,
  _createSocketHandle,
  guessHandleType,
};
