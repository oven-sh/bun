const EventEmitter = require('node:events');

class Stream extends EventEmitter {
  constructor() {
    super();
  }

  pipe(dest, options) {
    const source = this;

    function ondata(chunk) {
      if (dest.writable !== false) {
        if (dest.write(chunk) === false && source.pause) {
          source.pause();
        }
      }
    }

    source.on('data', ondata);

    function ondrain() {
      if (source.resume) source.resume();
    }

    dest.on('drain', ondrain);

    // Si la source se termine, on termine la destination (sauf si end: false)
    const endDestination = !options || options.end !== false;
    let didOnEnd = false;

    function onend() {
      if (didOnEnd) return;
      didOnEnd = true;
      if (endDestination && typeof dest.end === 'function') {
        dest.end();
      }
    }

    function onclose() {
      if (didOnEnd) return;
      didOnEnd = true;
      if (typeof dest.destroy === 'function') {
        dest.destroy();
      }
    }

    source.on('end', onend);
    source.on('close', onclose);

    function onerror(er) {
      cleanup();
      if (dest.listenerCount('error') > 0) {
        dest.emit('error', er);
      }
    }

    source.on('error', onerror);

    function cleanup() {
      source.removeListener('data', ondata);
      dest.removeListener('drain', ondrain);
      source.removeListener('end', onend);
      source.removeListener('close', onclose);
      source.removeListener('error', onerror);
    }

    dest.on('close', cleanup);
    dest.emit('pipe', source);

    return dest;
  }
}

class Readable extends Stream {
  constructor(options = {}) {
    super();
    this.readable = true;
    this._readableState = {
      flowing: null,
      ended: false,
      reading: false,
      buffer: [],
      destroyed: false,
      objectMode: !!options.objectMode,
      highWaterMark: options.highWaterMark || 16 * 1024
    };
    if (options.read) {
      this._read = options.read;
    }
  }

  _read(size) {
    // Devra être surchargée par l'implémentation concrète
  }

  push(chunk, encoding) {
    const state = this._readableState;
    if (chunk === null) {
      state.ended = true;
      if (state.flowing) {
        process.nextTick(() => {
          this.emit('end');
          this.destroy();
        });
      } else {
        this.emit('readable');
      }
      return false;
    }

    state.buffer.push(chunk);
    if (state.flowing) {
      process.nextTick(() => this._flow());
    } else {
      this.emit('readable');
    }
    return state.buffer.length < state.highWaterMark;
  }

  _flow() {
    const state = this._readableState;
    while (state.buffer.length > 0 && state.flowing) {
      const chunk = state.buffer.shift();
      this.emit('data', chunk);
    }
    if (state.buffer.length === 0 && state.flowing && !state.ended && !state.reading) {
      state.reading = true;
      try {
        this._read();
      } finally {
        state.reading = false;
      }
    }
    if (state.buffer.length === 0 && state.ended && state.flowing) {
      this.emit('end');
      this.destroy();
    }
  }

  read(size) {
    const state = this._readableState;
    if (state.buffer.length === 0) {
      if (!state.ended && !state.reading) {
        state.reading = true;
        try {
          this._read(size);
        } finally {
          state.reading = false;
        }
      }
      return null;
    }
    const chunk = state.buffer.shift();
    if (state.buffer.length === 0 && state.ended) {
      process.nextTick(() => {
        this.emit('end');
        this.destroy();
      });
    }
    return chunk;
  }

  pause() {
    this._readableState.flowing = false;
    return this;
  }

  resume() {
    this._readableState.flowing = true;
    process.nextTick(() => this._flow());
    return this;
  }

  on(ev, fn) {
    super.on(ev, fn);
    if (ev === 'data') {
      if (this._readableState.flowing !== false) {
        this.resume();
      }
    }
    return this;
  }

  destroy(err) {
    const state = this._readableState;
    if (state.destroyed) return;
    state.destroyed = true;
    this.readable = false;
    if (err) {
      process.nextTick(() => this.emit('error', err));
    }
    process.nextTick(() => this.emit('close'));
  }
}

class Writable extends Stream {
  constructor(options = {}) {
    super();
    this.writable = true;
    this._writableState = {
      ended: false,
      writing: false,
      buffer: [],
      destroyed: false,
      finished: false,
      objectMode: !!options.objectMode,
      highWaterMark: options.highWaterMark || 16 * 1024
    };
    if (options.write) {
      this._write = options.write;
    }
  }

  _write(chunk, encoding, callback) {
    if (callback) callback();
  }

  write(chunk, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = 'utf8';
    }

    const state = this._writableState;
    if (state.ended) {
      const err = new Error('write after end');
      if (callback) callback(err);
      else this.emit('error', err);
      return false;
    }

    if (state.writing) {
      state.buffer.push({ chunk, encoding, callback });
      return false;
    }

    state.writing = true;
    try {
      this._write(chunk, encoding, (err) => {
        state.writing = false;
        if (err) {
          if (callback) callback(err);
          else this.emit('error', err);
        } else {
          if (callback) callback();
          this._flushBuffer();
        }
      });
    } catch (e) {
      state.writing = false;
      if (callback) callback(e);
      else this.emit('error', e);
    }
    return state.buffer.length < state.highWaterMark;
  }

  _flushBuffer() {
    const state = this._writableState;
    if (state.buffer.length > 0) {
      const { chunk, encoding, callback } = state.buffer.shift();
      state.writing = true;
      try {
        this._write(chunk, encoding, (err) => {
          state.writing = false;
          if (err) {
            if (callback) callback(err);
            else this.emit('error', err);
          } else {
            if (callback) callback();
            this._flushBuffer();
          }
        });
      } catch (e) {
        state.writing = false;
        if (callback) callback(e);
        else this.emit('error', e);
      }
    } else {
      this.emit('drain');
      if (state.ended && !state.finished) {
        state.finished = true;
        this.emit('finish');
      }
    }
  }

  end(chunk, encoding, callback) {
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = null;
    } else if (typeof encoding === 'function') {
      callback = encoding;
      encoding = 'utf8';
    }

    const state = this._writableState;
    if (chunk !== null && chunk !== undefined) {
      this.write(chunk, encoding);
    }

    state.ended = true;
    if (!state.writing && state.buffer.length === 0) {
      if (!state.finished) {
        state.finished = true;
        process.nextTick(() => {
          this.emit('finish');
          if (callback) callback();
        });
      }
    } else {
      if (callback) this.on('finish', callback);
    }
  }

  destroy(err) {
    const state = this._writableState;
    if (state.destroyed) return;
    state.destroyed = true;
    this.writable = false;
    if (err) {
      process.nextTick(() => this.emit('error', err));
    }
    process.nextTick(() => this.emit('close'));
  }
}

class Duplex extends Readable {
  constructor(options = {}) {
    super(options);
    this.writable = true;
    this._writableState = {
      ended: false,
      writing: false,
      buffer: [],
      destroyed: false,
      finished: false,
      objectMode: !!options.objectMode,
      highWaterMark: options.highWaterMark || 16 * 1024
    };
    if (options.write) {
      this._write = options.write;
    }
  }

  write(chunk, encoding, callback) {
    return Writable.prototype.write.call(this, chunk, encoding, callback);
  }

  _write(chunk, encoding, callback) {
    if (callback) callback();
  }

  _flushBuffer() {
    return Writable.prototype._flushBuffer.call(this);
  }

  end(chunk, encoding, callback) {
    return Writable.prototype.end.call(this, chunk, encoding, callback);
  }
}

class Transform extends Duplex {
  constructor(options = {}) {
    super(options);
    if (options.transform) {
      this._transform = options.transform;
    }
    if (options.flush) {
      this._flush = options.flush;
    }
  }

  _write(chunk, encoding, callback) {
    this._transform(chunk, encoding, (err, data) => {
      if (err) {
        this.destroy(err);
        return;
      }
      if (data !== undefined && data !== null) {
        this.push(data);
      }
      callback();
    });
  }

  _read(size) {
    // Dans un Transform stream, _read n'a pas besoin de faire d'action car push() 
    // est déclenché par write()/_transform().
  }

  _transform(chunk, encoding, callback) {
    // Par défaut, passthrough (transparent)
    callback(null, chunk);
  }

  end(chunk, encoding, callback) {
    const endCb = () => {
      if (this._flush) {
        this._flush((err, data) => {
          if (err) {
            this.destroy(err);
            return;
          }
          if (data !== undefined && data !== null) {
            this.push(data);
          }
          this.push(null);
          if (callback) callback();
        });
      } else {
        this.push(null);
        if (callback) callback();
      }
    };
    super.end(chunk, encoding, endCb);
  }
}

function pipeline(...streams) {
  let callback;
  if (typeof streams[streams.length - 1] === 'function') {
    callback = streams.pop();
  }

  for (let i = 0; i < streams.length - 1; i++) {
    const src = streams[i];
    const dest = streams[i + 1];
    src.pipe(dest);
    src.on('error', (err) => {
      if (callback) callback(err);
      else dest.emit('error', err);
    });
  }

  const last = streams[streams.length - 1];
  last.on('finish', () => {
    if (callback) callback(null);
  });
  last.on('end', () => {
    if (callback) callback(null);
  });
  return last;
}

function finished(stream, callback) {
  let finishedCalled = false;
  const done = (err) => {
    if (finishedCalled) return;
    finishedCalled = true;
    callback(err);
  };
  stream.on('end', () => done(null));
  stream.on('finish', () => done(null));
  stream.on('close', () => done(null));
  stream.on('error', (err) => done(err));
}

module.exports = Stream;
module.exports.Stream = Stream;
module.exports.Readable = Readable;
module.exports.Writable = Writable;
module.exports.Duplex = Duplex;
module.exports.Transform = Transform;
module.exports.pipeline = pipeline;
module.exports.finished = finished;
