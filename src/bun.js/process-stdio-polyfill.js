var createReadStream;
var createWriteStream;

var StdioWriteStream;
var StdinStream;

var AbortError = class extends Error {
  constructor(message = "The operation was aborted", options = void 0) {
    if (options !== void 0 && typeof options !== "object") {
      throw new Error(
        `Invalid AbortError options:\n\n${JSON.stringify(options, null, 2)}`,
      );
    }
    super(message, options);
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
};

function lazyLoadDeps({ require }) {
  var {
    createWriteStream: _createWriteStream,
    createReadStream: _createReadStream,
  } = require("node:fs", "node:process");
  createWriteStream = _createWriteStream;
  createReadStream = _createReadStream;
}

function getStdioWriteStream({ require }) {
  if (!StdioWriteStream) {
    var { Duplex, eos, destroy } = require("node:stream", "node:process");
    if (!createWriteStream) {
      lazyLoadDeps({ require });
    }

    StdioWriteStream = class StdioWriteStream extends Duplex {
      #writeStream;
      #readStream;

      #readable = true;
      #writable = true;
      #fdPath;

      #onClose;
      #onDrain;
      #onFinish;
      #onReadable;

      fd = 1;
      get isTTY() {
        return require("tty").isatty(this.fd);
      }

      constructor(fd) {
        super({ readable: true, writable: true });
        this.#fdPath = `/dev/fd/${fd}`;

        Object.defineProperty(this, "fd", {
          value: fd,
          writable: false,
          configurable: false,
        });
      }

      #onFinished(err) {
        const cb = this.#onClose;
        this.#onClose = null;

        if (cb) {
          cb(err);
        } else if (err) {
          this.destroy(err);
        } else if (!this.#readable && !this.#writable) {
          this.destroy();
        }
      }

      _destroy(err, callback) {
        if (!err && this.#onClose !== null) {
          err = new AbortError();
        }
        this.#onDrain = null;
        this.#onFinish = null;
        if (this.#onClose === null) {
          callback(err);
        } else {
          this.#onClose = callback;
          if (this.#writeStream) destroy(this.#writeStream, err);
          if (this.#readStream) destroy(this.#readStream, err);
        }
      }

      _write(chunk, encoding, callback) {
        if (!this.#writeStream) {
          this.#writeStream = createWriteStream(this.#fdPath);

          this.#writeStream.on("finish", () => {
            if (this.#onFinish) {
              const cb = this.#onFinish;
              this.#onFinish = null;
              cb();
            }
          });

          this.#writeStream.on("drain", () => {
            if (this.#onDrain) {
              const cb = this.#onDrain;
              this.#onDrain = null;
              cb();
            }
          });

          eos(this.#writeStream, (err) => {
            this.#writable = false;
            if (err) {
              destroy(this.#writeStream, err);
            }
            this.#onFinished(err);
          });
        }
        if (this.#writeStream.write(chunk, encoding)) {
          callback();
        } else {
          this.#onDrain = callback;
        }
      }

      _final(callback) {
        this.#writeStream.end();
        this.#onFinish = callback;
      }

      _read() {
        if (!this.#readStream) {
          this.#readStream = createReadStream(this.#fdPath);

          this.#readStream.on("ready", () => {
            if (this.#onReadable) {
              const cb = this.#onReadable;
              this.#onReadable = null;
              cb();
            } else {
              this.read();
            }
          });

          this.#readStream.on("end", () => {
            this.push(null);
          });

          eos(this.#readStream, (err) => {
            this.#readable = false;
            if (err) {
              destroy(this.#readStream, err);
            }
            this.#onFinished(err);
          });
        }
        while (true) {
          const buf = this.#readStream.read();
          if (buf === null || !this.push(buf)) {
            return;
          }
        }
      }
    };
  }
  return StdioWriteStream;
}

function getStdinStream({ require }) {
  if (!StdinStream) {
    var {
      Readable,
      Duplex,
      eos,
      destroy,
    } = require("node:stream", "node:process");
    if (!createWriteStream) {
      lazyLoadDeps({ require });
    }

    StdinStream = class StdinStream extends Duplex {
      #readStream;
      #writeStream;

      #readable = true;
      #writable = true;

      #onFinish;
      #onClose;
      #onDrain;
      #onReadable;

      fd = 0;
      get isTTY() {
        return require("tty").isatty(this.fd);
      }

      constructor() {
        super({ readable: true, writable: true });

        Object.defineProperty(this, "fd", {
          value: 0,
          writable: false,
          configurable: false,
        });

        this.#onReadable = this._read.bind(this);
      }

      #onFinished(err) {
        const cb = this.#onClose;
        this.#onClose = null;

        if (cb) {
          cb(err);
        } else if (err) {
          this.destroy(err);
        } else if (!this.#readable && !this.#writable) {
          this.destroy();
        }
      }

      _destroy(err, callback) {
        if (!err && this.#onClose !== null) {
          err = new AbortError();
        }
        if (this.#onClose === null) {
          callback(err);
        } else {
          this.#onClose = callback;
          if (this.#readStream) destroy(this.#readStream, err);
          if (this.#writeStream) destroy(this.#writeStream, err);
        }
      }

      on(ev, cb) {
        super.on(ev, cb);
        if (!this.#readStream && (ev === "readable" || ev === "data")) {
          this.#readStream = Readable.fromWeb(Bun.stdin.stream());

          this.#readStream.on("readable", () => {
            const cb = this.#onReadable;
            this.#onReadable = null;
            cb();
          });

          this.#readStream.on("end", () => {
            this.push(null);
          });

          eos(this.#readStream, (err) => {
            this.#readable = false;
            if (err) {
              destroy(this.#readStream, err);
            }
            this.#onFinished(err);
          });
        }
      }

      _read() {
        while (true) {
          const buf = this.#readStream.read();
          if (buf === null || !this.push(buf)) {
            this.#onReadable = this._read.bind(this);
            return;
          }
        }
      }

      _write(chunk, encoding, callback) {
        if (!this.#writeStream) {
          this.#writeStream = createWriteStream("/dev/fd/0");

          this.#writeStream.on("finish", () => {
            if (this.#onFinish) {
              const cb = this.#onFinish;
              this.#onFinish = null;
              cb();
            }
          });

          this.#writeStream.on("drain", () => {
            if (this.#onDrain) {
              const cb = this.#onDrain;
              this.#onDrain = null;
              cb();
            }
          });

          eos(this.#writeStream, (err) => {
            this.#writable = false;
            if (err) {
              destroy(this.#writeStream, err);
            }
            this.#onFinished(err);
          });
        }

        if (this.#writeStream.write(chunk, encoding)) {
          callback();
        } else {
          this.#onDrain = callback;
        }
      }

      _final(callback) {
        this.#writeStream.end();
        this.#onFinish = callback.bind(this);
      }
    };
  }
  return StdinStream;
}

export function stdin({ require }) {
  var StdinStream = getStdinStream({ require });
  var stream = new StdinStream();
  return stream;
}

export function stdout({ require }) {
  var StdioWriteStream = getStdioWriteStream({ require });
  var stream = new StdioWriteStream(1);
  return stream;
}

export function stderr({ require }) {
  var StdioWriteStream = getStdioWriteStream({ require });
  var stream = new StdioWriteStream(2);
  return stream;
}

export default {
  stdin,
  stdout,
  stderr,

  [Symbol.for("CommonJS")]: 0,
};
