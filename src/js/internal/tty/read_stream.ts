// tty.ReadStream alone: it is a net.Socket, and node:tty must not load node:net for isatty().

const { ErrnoException } = require("internal/shared");
const net = require("node:net");

const ObjectDefineProperty = Object.defineProperty;

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
      fd: number | null;
      isRaw: boolean;
      isTTY: boolean;
      setRawMode(flag: boolean): this;
    }
  }
}

// Node puts `fd` on process.stdin alone (lib/internal/bootstrap/switches/is_main_thread.js#L248-L249). Bun's stream always had one: the caller's descriptor while the handle is open, and null from then on, so a closed stream names no descriptor that is another's by now.
const fdOfOpenHandle: PropertyDescriptor & ThisType<$Node.TTYReadStream> = {
  enumerable: true,
  configurable: true,
  get() {
    const fd = (this._handle as unknown as $Node.StreamWrapHandle | null)?.fd;
    return fd! >= 0 ? fd : null;
  },
  set(value) {
    ObjectDefineProperty(this, "fd", { value, writable: true, enumerable: true, configurable: true });
  },
};

// https://github.com/nodejs/node/blob/v26.12.1/lib/tty.js#L58-L80
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
    // A chunk that no consumer takes at once stops the handle: nothing is read ahead.
    readableHighWaterMark: 0,
    handle: tty,
    manualStart: true,
    ...options,
  });

  ObjectDefineProperty(this, "fd", fdOfOpenHandle);
  this.isRaw = false;
  this.isTTY = true;
}
$toClass(ReadStream, "ReadStream", net.Socket);

// libuv's `uv_tty_mode_t`. RAW_VT is the raw mode that Node asks for.
const UV_TTY_MODE_NORMAL = 0;
const UV_TTY_MODE_RAW_VT = 3;

ReadStream.prototype.setRawMode = function (this: $Node.TTYReadStream, flag: boolean) {
  flag = !!flag;
  // Node does not throw when setting the mode fails: an error event is emitted.
  const err = (this._handle as unknown as $Node.StreamWrapHandle | null)?.setRawMode(
    flag ? UV_TTY_MODE_RAW_VT : UV_TTY_MODE_NORMAL,
  );
  if (err) {
    this.emit("error", new ErrnoException(err, "setRawMode"));
    return this;
  }
  this.isRaw = flag;
  return this;
};

export default { ReadStream };
