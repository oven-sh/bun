const Writable = require("internal/streams/writable");

const ProcessNextTick = process.nextTick;

const _native = Symbol("native");
const _pathOrFdOrSink = Symbol("pathOrFdOrSink");
const { fileSinkSymbol: _fileSink } = require("internal/shared");

function NativeWritable(pathOrFdOrSink, options = {}) {
  Writable.$call(this, options);

  this[_native] = true;

  this._construct = NativeWritable_internalConstruct;
  this._final = NativeWritable_internalFinal;
  this._write = NativeWritablePrototypeWrite;

  this[_pathOrFdOrSink] = pathOrFdOrSink;
}
$toClass(NativeWritable, "NativeWritable", Writable);

// These are confusingly two different fns for construct which initially were the same thing because
// `_construct` is part of the lifecycle of Writable and is not called lazily,
// so we need to separate our _construct for Writable state and actual construction of the write stream
function NativeWritable_internalConstruct(cb) {
  this._writableState.constructed = true;
  this.constructed = true;
  if (typeof cb === "function") ProcessNextTick(cb);
  ProcessNextTick(() => {
    this.emit("open", this.fd);
    this.emit("ready");
  });
}

function NativeWritable_internalFinal(cb) {
  var sink = this[_fileSink];
  if (sink) {
    const end = sink.end(true);
    if ($isPromise(end) && cb) {
      end.then(() => {
        if (cb) cb();
      }, cb);
    }
  }
  if (cb) cb();
}

function NativeWritablePrototypeWrite(chunk, encoding, cb) {
  var fileSink = this[_fileSink] ?? NativeWritable_lazyConstruct(this);
  var result = fileSink.write(chunk);

  if (typeof encoding === "function") {
    cb = encoding;
  }

  if ($isPromise(result)) {
    // var writePromises = this.#writePromises;
    // var i = writePromises.length;
    // writePromises[i] = result;
    result
      .then(result => {
        this.emit("drain");
        if (cb) {
          cb(null, result);
        }
      })
      .catch(
        cb
          ? err => {
              cb(err);
            }
          : err => {
              this.emit("error", err);
            },
      );
    return false;
  }

  // TODO: Should we just have a calculation based on encoding and length of chunk?
  if (cb) cb(null, chunk.byteLength);
  return true;
}

function NativeWritable_lazyConstruct(stream) {
  // TODO: Turn this check into check for instanceof FileSink
  var sink = stream[_pathOrFdOrSink];
  if (typeof sink === "object") {
    if (typeof sink.write === "function") {
      return (stream[_fileSink] = sink);
    } else {
      throw new Error("Invalid FileSink");
    }
  } else {
    return (stream[_fileSink] = Bun.file(sink).writer());
  }
}

const WritablePrototypeEnd = Writable.prototype.end;
NativeWritable.prototype.end = function end(chunk, encoding, cb, native) {
  return WritablePrototypeEnd.$call(this, chunk, encoding, cb, native ?? this[_native]);
};

NativeWritable.prototype._destroy = function (error, cb) {
  const w = this._writableState;
  const r = this._readableState;

  if (w) {
    w.destroyed = true;
    w.closeEmitted = true;
  }
  if (r) {
    r.destroyed = true;
    r.closeEmitted = true;
  }

  if (typeof cb === "function") cb(error);

  if (w?.closeEmitted || r?.closeEmitted) {
    this.emit("close");
  }
};

NativeWritable.prototype.ref = function ref() {
  const sink = (this[_fileSink] ||= NativeWritable_lazyConstruct(this));
  sink.ref();
  return this;
};

NativeWritable.prototype.unref = function unref() {
  const sink = (this[_fileSink] ||= NativeWritable_lazyConstruct(this));
  sink.unref();
  return this;
};

export default NativeWritable;
