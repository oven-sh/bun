// tty.ReadStream alone: it is a net.Socket, and node:tty must not load node:net for isatty().

const { ErrnoException } = require("internal/shared");
const net = require("node:net");

/** What `new TTY(fd, ctx)` fills in where libuv's `uv_tty_init` would have failed. */
interface TTYInitContext {
  errno?: number;
  code?: string;
  syscall?: string;
  message?: string;
}
const TTY = $bindgen("tty_wrap.bind.ts", "TTY");

declare global {
  namespace $Node {
    interface TTYReadStream extends Socket {
      fd: number;
      isRaw: boolean;
      isTTY: boolean;
      setRawMode(flag: boolean): this;
    }
  }
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/tty.js#L51-L72
function ReadStream(this: $Node.TTYReadStream, fd: number, options?: $Node.SocketOptions): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(fd, options) as any;
  }
  if (fd >> 0 !== fd || fd < 0) {
    throw $ERR_INVALID_FD(fd);
  }

  const ctx: TTYInitContext = {};
  const tty = new TTY(fd, ctx);
  const { code, syscall, message, errno } = ctx;
  if (code !== undefined) {
    // Node's ERR_TTY_INIT_FAILED is a SystemError: it carries the uv context.
    const err = $ERR_TTY_INIT_FAILED(`${syscall} returned ${code} (${message})`) as Error & {
      info?: TTYInitContext;
      errno?: number;
      syscall?: string;
    };
    err.name = "SystemError";
    err.info = ctx;
    err.errno = errno;
    err.syscall = syscall;
    throw err;
  }

  net.Socket.$call(this, {
    // Every push() reports backpressure: the handle reads only while a consumer pulls.
    readableHighWaterMark: 0,
    handle: tty,
    manualStart: true,
    ...options,
  });

  this.fd = fd;
  this.isRaw = false;
  this.isTTY = true;
}
$toClass(ReadStream, "ReadStream", net.Socket);

ReadStream.prototype.setRawMode = function (this: $Node.TTYReadStream, flag: boolean) {
  flag = !!flag;
  // Node does not throw when setting the mode fails: an error event is emitted.
  const err = (this._handle as unknown as $Node.StreamWrapHandle | null)?.setRawMode(flag);
  if (err) {
    this.emit("error", new ErrnoException(err, "setRawMode"));
    return this;
  }
  this.isRaw = flag;
  return this;
};

export default { ReadStream };
