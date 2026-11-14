// Apart from internal/shared, which every program loads.
const { ErrnoException, ExceptionWithHostPort } = require("internal/shared");
const { getSystemErrorMessage, getSystemErrorName } = require("node:util");

// https://github.com/nodejs/node/blob/v26.5.0/lib/internal/errors.js#L689-L716
function uvExceptionWithHostPort(err: number, syscall: string, address: string | null, port?: number) {
  const code = getSystemErrorName(err);
  let details = "";
  if (port && port > 0) {
    details = ` ${address}:${port}`;
  } else if (address) {
    details = ` ${address}`;
  }

  const error: any = new Error(`${syscall} ${code}: ${getSystemErrorMessage(err)}${details}`);
  error.code = code;
  error.errno = err;
  error.syscall = syscall;
  error.address = address;
  if (port) {
    error.port = port;
  }
  return error;
}

// The error net.Server emits for what Bun.serve() or Bun.listen() threw. `address` is null for a descriptor, `port` is -1 for a pipe.
function listenException(err, address: string | null, port?: number) {
  // Node emits a failed lookup's error as dns.lookup() made it.
  if (err?.syscall === "getaddrinfo") return err;
  let code = err?.code;
  if (address === null) {
    // https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2063-L2070
    if (code === "EBADF" || code === "ENOTSOCK" || code === "EOPNOTSUPP") code = "EINVAL";
  } else if (port === -1) {
    // https://github.com/libuv/libuv/blob/v1.51.0/src/unix/pipe.c#L58-L128
    if (code === "ENAMETOOLONG") code = "EINVAL";
    else if (code === "ENOENT") code = "EACCES";
  }
  const errno = process.binding("uv")[`UV_${code}`];
  return errno === undefined ? err : uvExceptionWithHostPort(errno, "listen", address, port);
}

// The error dgram.Socket reports for what Bun.udpSocket() threw. `address` is undefined for a descriptor, which Node opens.
function bindException(err, address?: string, port?: number) {
  const syscall = address === undefined ? "open" : "bind";
  const errno = err?.syscall === syscall ? process.binding("uv")[`UV_${err.code}`] : undefined;
  if (errno === undefined) return err;
  return address === undefined
    ? new ErrnoException(errno, syscall)
    : new ExceptionWithHostPort(errno, syscall, address, port);
}

export default { listenException, bindException };
