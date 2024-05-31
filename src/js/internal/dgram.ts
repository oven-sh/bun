const dns = require("node:dns");
const { guessHandleType } = require("internal/shared");

const ERR_SOCKET_BAD_TYPE = $zig("node_error_binding.zig", "ERR_SOCKET_BAD_TYPE");
const ERR_INVALID_ARG_TYPE = $zig("node_error_binding.zig", "ERR_INVALID_ARG_TYPE");
const UV_EINVAL = -4071;

export const kStateSymbol = Symbol("state symbol");

function lookup4(lookup, address, callback) {
  return lookup(address || "127.0.0.1", 4, callback);
}

function lookup6(lookup, address, callback) {
  return lookup(address || "::1", 6, callback);
}

export function newHandle(type, lookup?) {
  if (lookup === undefined) {
    lookup = dns.lookup;
  } else {
    validateFunction(lookup, "lookup");
  }

  if (type === "udp4") {
    const handle = new UDP();

    handle.lookup = lookup4.bind(handle, lookup);
    return handle;
  }

  if (type === "udp6") {
    const handle = new UDP();

    handle.lookup = lookup6.bind(handle, lookup);
    handle.bind = handle.bind6;
    handle.connect = handle.connect6;
    handle.send = handle.send6;
    return handle;
  }

  throw ERR_SOCKET_BAD_TYPE();
}

export function _createSocketHandle(address, port, addressType, fd, flags) {
  const handle = newHandle(addressType);
  let err;

  if (isInt32(fd) && fd > 0) {
    const type = guessHandleType(fd);
    if (type !== "UDP") {
      err = UV_EINVAL;
    } else {
      err = handle.open(fd);
    }
  } else if (port || address) {
    err = handle.bind(address, port || 0, flags);
  }

  if (err) {
    handle.close();
    return err;
  }

  return handle;
}

function isInt32(value) {
  return value === (value | 0);
}

function validateFunction(cb, name) {
  if (typeof cb !== "function") {
    throw ERR_INVALID_ARG_TYPE(name, "function", typeof cb);
  }
}

class UDP {
  constructor() {
    throw new Error("TODO");
  }
}
