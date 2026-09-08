// Hardcoded module "node:tty"

const { ErrnoException } = require("internal/shared");
const { WriteStream, isatty } = require("internal/tty/write_stream");
const net = require("node:net");
const { TTY } = process.binding("tty_wrap");

// https://github.com/nodejs/node/blob/v26.3.0/lib/tty.js#L50
// readableHighWaterMark: 0 makes every push() report backpressure, so the
// handle only reads while a consumer pulls.
function ReadStream(fd, options): void {
  if (!(this instanceof ReadStream)) {
    return new ReadStream(fd, options);
  }
  if (fd >> 0 !== fd || fd < 0) {
    throw $ERR_INVALID_FD(fd);
  }

  const ctx: { code?: string; syscall?: string; message?: string; errno?: number } = {};
  const tty = new TTY(fd, ctx);
  if (ctx.code !== undefined) {
    // Node's ERR_TTY_INIT_FAILED is a SystemError: it carries the uv context.
    const err = $ERR_TTY_INIT_FAILED(`${ctx.syscall} returned ${ctx.code} (${ctx.message})`);
    err.name = "SystemError";
    err.info = ctx;
    err.errno = ctx.errno;
    err.syscall = ctx.syscall;
    throw err;
  }

  net.Socket.$call(this, {
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

ReadStream.prototype.setRawMode = function (flag) {
  flag = !!flag;
  // Node does not throw when setting the mode fails: an error event is emitted.
  const err = this._handle?.setRawMode(flag);
  if (err) {
    this.emit("error", new ErrnoException(err, "setRawMode"));
    return this;
  }
  this.isRaw = flag;
  return this;
};

export default { ReadStream, WriteStream, isatty };
