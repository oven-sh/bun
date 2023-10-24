// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ProcessObjectInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(fd) {  const tty = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 46/*node:tty*/) || __intrinsic__createInternalModuleById(46/*node:tty*/));

  const stream = tty.WriteStream(fd);

  process.on("SIGWINCH", () => {
    stream._refreshSize();
  });

  if (fd === 1) {
    stream.destroySoon = stream.destroy;
    stream._destroy = function (err, cb) {
      cb(err);
      this._undestroy();

      if (!this._writableState.emitClose) {
        process.nextTick(() => {
          this.emit("close");
        });
      }
    };
  } else if (fd === 2) {
    stream.destroySoon = stream.destroy;
    stream._destroy = function (err, cb) {
      cb(err);
      this._undestroy();

      if (!this._writableState.emitClose) {
        process.nextTick(() => {
          this.emit("close");
        });
      }
    };
  }

  stream._type = "tty";
  stream._isStdio = true;
  stream.fd = fd;

  return stream;
}).$$capture_end$$;
