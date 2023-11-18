const readStreamPathFastPathSymbol = Symbol.for("Bun.Node.readStreamPathFastPath");
const readStreamSymbol = Symbol.for("Bun.NodeReadStream");
const readStreamPathOrFdSymbol = Symbol.for("Bun.NodeReadStreamPathOrFd");
const { kIoDone, writeStreamPathFastPathCallSymbol, writeStreamPathFastPathSymbol } = require("internal/symbols");
const { read, open, openSync, close, fstatSync } = require("node:fs");
const Stream = require("node:stream");
var ReadStreamClass;
var defaultReadStreamOptions = {
  file: undefined,
  fd: null,
  flags: "r",
  encoding: undefined,
  mode: 0o666,
  autoClose: true,
  emitClose: true,
  start: 0,
  end: Infinity,
  highWaterMark: 64 * 1024,
  fs: {
    read,
    open,
    openSync,
    close,
  },
  autoDestroy: true,
};

var ReadStream = (function (InternalReadStream) {
  ReadStreamClass = InternalReadStream;
  Object.defineProperty(ReadStreamClass.prototype, Symbol.toStringTag, {
    value: "ReadStream",
    enumerable: false,
  });
  function ReadStream(path, options) {
    return new InternalReadStream(path, options);
  }
  ReadStream.prototype = InternalReadStream.prototype;
  return Object.defineProperty(ReadStream, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalReadStream;
    },
  });
})(
  class ReadStream extends Stream._getNativeReadableStreamPrototype(2, Stream.Readable) {
    constructor(pathOrFd, options = defaultReadStreamOptions) {
      if (typeof options !== "object" || !options) {
        throw new TypeError("Expected options to be an object");
      }

      var {
        flags = defaultReadStreamOptions.flags,
        encoding = defaultReadStreamOptions.encoding,
        mode = defaultReadStreamOptions.mode,
        autoClose = defaultReadStreamOptions.autoClose,
        emitClose = defaultReadStreamOptions.emitClose,
        start = defaultReadStreamOptions.start,
        end = defaultReadStreamOptions.end,
        autoDestroy = defaultReadStreamOptions.autoClose,
        fs = defaultReadStreamOptions.fs,
        highWaterMark = defaultReadStreamOptions.highWaterMark,
        fd = defaultReadStreamOptions.fd,
      } = options;

      if (pathOrFd?.constructor?.name === "URL") {
        pathOrFd = Bun.fileURLToPath(pathOrFd);
      }

      // This is kinda hacky but we create a temporary object to assign props that we will later pull into the `this` context after we call super
      var tempThis = {};
      if (fd != null) {
        if (typeof fd !== "number") {
          throw new TypeError("Expected options.fd to be a number");
        }
        tempThis.fd = tempThis[readStreamPathOrFdSymbol] = fd;
        tempThis.autoClose = false;
      } else if (typeof pathOrFd === "string") {
        if (pathOrFd.startsWith("file://")) {
          pathOrFd = Bun.fileURLToPath(pathOrFd);
        }
        if (pathOrFd.length === 0) {
          throw new TypeError("Expected path to be a non-empty string");
        }
        tempThis.path = tempThis.file = tempThis[readStreamPathOrFdSymbol] = pathOrFd;
      } else if (typeof pathOrFd === "number") {
        pathOrFd |= 0;
        if (pathOrFd < 0) {
          throw new TypeError("Expected fd to be a positive integer");
        }
        tempThis.fd = tempThis[readStreamPathOrFdSymbol] = pathOrFd;

        tempThis.autoClose = false;
      } else {
        throw new TypeError("Expected a path or file descriptor");
      }

      // If fd not open for this file, open it
      if (tempThis.fd === undefined) {
        // NOTE: this fs is local to constructor, from options
        tempThis.fd = fs.openSync(pathOrFd, flags, mode);
      }
      // Get FileRef from fd
      var fileRef = Bun.file(tempThis.fd);

      // Get the stream controller
      // We need the pointer to the underlying stream controller for the NativeReadable
      var stream = fileRef.stream();
      var native = $direct(stream);
      if (!native) {
        $debug("no native readable stream");
        throw new Error("no native readable stream");
      }
      var { stream: ptr } = native;

      super(ptr, {
        ...options,
        encoding,
        autoDestroy,
        autoClose,
        emitClose,
        highWaterMark,
      });

      // Assign the tempThis props to this
      Object.assign(this, tempThis);
      this.#fileRef = fileRef;

      this.end = end;
      this._read = this.#internalRead;
      this.start = start;
      this.flags = flags;
      this.mode = mode;
      this.emitClose = emitClose;

      this[readStreamPathFastPathSymbol] =
        start === 0 &&
        end === Infinity &&
        autoClose &&
        fs === defaultReadStreamOptions.fs &&
        // is it an encoding which we don't need to decode?
        (encoding === "buffer" ||
          encoding === "binary" ||
          encoding == null ||
          encoding === "utf-8" ||
          encoding === "utf8");
      this._readableState.autoClose = autoDestroy = autoClose;
      this._readableState.highWaterMark = highWaterMark;

      if (start !== undefined) {
        this.pos = start;
      }
    }
    #fileRef;
    #fs;
    file;
    path;
    fd = null;
    flags;
    mode;
    start;
    end;
    pos;
    bytesRead = 0;
    #fileSize = -1;
    _read;

    [readStreamSymbol] = true;
    [readStreamPathOrFdSymbol];
    [readStreamPathFastPathSymbol];

    _construct(callback) {
      if (super._construct) {
        super._construct(callback);
      } else {
        callback();
      }
      this.emit("open", this.fd);
      this.emit("ready");
    }

    _destroy(err, cb) {
      super._destroy(err, cb);
      try {
        var fd = this.fd;
        this[readStreamPathFastPathSymbol] = false;

        if (!fd) {
          cb(err);
        } else {
          this.#fs.close(fd, er => {
            cb(er || err);
          });
          this.fd = null;
        }
      } catch (e) {
        throw e;
      }
    }

    close(cb) {
      if (typeof cb === "function") Stream.eos(this, cb);
      this.destroy();
    }

    push(chunk) {
      // Is it even possible for this to be less than 1?
      var bytesRead = chunk?.length ?? 0;
      if (bytesRead > 0) {
        this.bytesRead += bytesRead;
        var currPos = this.pos;
        // Handle case of going through bytes before pos if bytesRead is less than pos
        // If pos is undefined, we are reading through the whole file
        // Otherwise we started from somewhere in the middle of the file
        if (currPos !== undefined) {
          // At this point we still haven't hit our `start` point
          // We should discard this chunk and exit
          if (this.bytesRead < currPos) {
            return true;
          }
          // At this point, bytes read is greater than our starting position
          // If the current position is still the starting position, that means
          // this is the first chunk where we care about the bytes read
          // and we need to subtract the bytes read from the start position (n) and slice the last n bytes
          if (currPos === this.start) {
            var n = this.bytesRead - currPos;
            chunk = chunk.slice(-n);
            var [_, ...rest] = arguments;
            this.pos = this.bytesRead;
            if (this.end !== undefined && this.bytesRead > this.end) {
              chunk = chunk.slice(0, this.end - this.start + 1);
            }
            return super.push(chunk, ...rest);
          }
          var end = this.end;
          // This is multi-chunk read case where we go passed the end of the what we want to read in the last chunk
          if (end !== undefined && this.bytesRead > end) {
            chunk = chunk.slice(0, end - currPos + 1);
            var [_, ...rest] = arguments;
            this.pos = this.bytesRead;
            return super.push(chunk, ...rest);
          }
          this.pos = this.bytesRead;
        }
      }

      return super.push(...arguments);
    }

    // #

    // n should be the the highwatermark passed from Readable.read when calling internal _read (_read is set to this private fn in this class)
    #internalRead(n) {
      // pos is the current position in the file
      // by default, if a start value is provided, pos starts at this.start
      var { pos, end, bytesRead, fd, encoding } = this;

      n =
        pos !== undefined // if there is a pos, then we are reading from that specific position in the file
          ? Math.min(end - pos + 1, n) // takes smaller of length of the rest of the file to read minus the cursor position, or the highwatermark
          : Math.min(end - bytesRead + 1, n); // takes the smaller of the length of the rest of the file from the bytes that we have marked read, or the highwatermark

      $debug("n @ fs.ReadStream.#internalRead, after clamp", n);

      // If n is 0 or less, then we read all the file, push null to stream, ending it
      if (n <= 0) {
        this.push(null);
        return;
      }

      // At this point, n is the lesser of the length of the rest of the file to read or the highwatermark
      // Which means n is the maximum number of bytes to read

      // Basically if we don't know the file size yet, then check it
      // Then if n is bigger than fileSize, set n to be fileSize
      // This is a fast path to avoid allocating more than the file size for a small file (is this respected by native stream though)
      if (this.#fileSize === -1 && bytesRead === 0 && pos === undefined) {
        var stat = fstatSync(fd);
        this.#fileSize = stat.size;
        if (this.#fileSize > 0 && n > this.#fileSize) {
          n = this.#fileSize + 1;
        }
        $debug("fileSize", this.#fileSize);
      }

      // At this point, we know the file size and how much we want to read of the file
      this[kIoDone] = false;
      var res = super._read(n);
      $debug("res -- undefined? why?", res);
      if ($isPromise(res)) {
        var then = res?.then;
        if (then && $isCallable(then)) {
          res.then(
            () => {
              this[kIoDone] = true;
              // Tell ._destroy() that it's safe to close the fd now.
              if (this.destroyed) {
                this.emit(kIoDone);
              }
            },
            er => {
              this[kIoDone] = true;
              this.#errorOrDestroy(er);
            },
          );
        }
      } else {
        this[kIoDone] = true;
        if (this.destroyed) {
          this.emit(kIoDone);
          this.#errorOrDestroy(new Error("ERR_STREAM_PREMATURE_CLOSE"));
        }
      }
    }

    #errorOrDestroy(err, sync = null) {
      var {
        _readableState: r = { destroyed: false, autoDestroy: false },
        _writableState: w = { destroyed: false, autoDestroy: false },
      } = this;

      if (w?.destroyed || r?.destroyed) {
        return this;
      }
      if (r?.autoDestroy || w?.autoDestroy) this.destroy(err);
      else if (err) {
        this.emit("error", err);
      }
    }

    pause() {
      this[readStreamPathFastPathSymbol] = false;
      return super.pause();
    }

    resume() {
      this[readStreamPathFastPathSymbol] = false;
      return super.resume();
    }

    unshift(...args) {
      this[readStreamPathFastPathSymbol] = false;
      return super.unshift(...args);
    }

    pipe(dest, pipeOpts) {
      if (this[readStreamPathFastPathSymbol] && (pipeOpts?.end ?? true) && this._readableState?.pipes?.length === 0) {
        if (writeStreamPathFastPathSymbol in dest && dest[writeStreamPathFastPathSymbol]) {
          if (dest[writeStreamPathFastPathCallSymbol](this, pipeOpts)) {
            return this;
          }
        }
      }

      this[readStreamPathFastPathSymbol] = false;
      return super.pipe(dest, pipeOpts);
    }
  },
);

export default { ReadStream: ReadStreamClass };
