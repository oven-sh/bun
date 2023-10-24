// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(nativePtr,nativeType,inputStream) {  const symbol = globalThis.Symbol.for("Bun.consumeReadableStreamPrototype");
  var cached = globalThis[symbol];
  if (!cached) {
    cached = globalThis[symbol] = [];
  }
  var Prototype = cached[nativeType];
  if (Prototype === undefined) {
    var [doRead, doError, doReadMany, doClose, onClose, deinit] = __intrinsic__lazy(nativeType);

    Prototype = class NativeReadableStreamSink {
      handleError: any;
      handleClosed: any;
      processResult: any;

      constructor(reader, ptr) {
        this.#ptr = ptr;
        this.#reader = reader;
        this.#didClose = false;

        this.handleError = this._handleError.bind(this);
        this.handleClosed = this._handleClosed.bind(this);
        this.processResult = this._processResult.bind(this);

        reader.closed.then(this.handleClosed, this.handleError);
      }

      _handleClosed() {
        if (this.#didClose) return;
        this.#didClose = true;
        var ptr = this.#ptr;
        this.#ptr = 0;
        doClose(ptr);
        deinit(ptr);
      }

      _handleError(error) {
        if (this.#didClose) return;
        this.#didClose = true;
        var ptr = this.#ptr;
        this.#ptr = 0;
        doError(ptr, error);
        deinit(ptr);
      }

      #ptr;
      #didClose = false;
      #reader;

      _handleReadMany({ value, done, size }) {
        if (done) {
          this.handleClosed();
          return;
        }

        if (this.#didClose) return;

        doReadMany(this.#ptr, value, done, size);
      }

      read() {
        if (!this.#ptr) return __intrinsic__throwTypeError("ReadableStreamSink is already closed");

        return this.processResult(this.#reader.read());
      }

      _processResult(result) {
        if (result && __intrinsic__isPromise(result)) {
          const flags = __intrinsic__getPromiseInternalField(result, __intrinsic__promiseFieldFlags);
          if (flags & __intrinsic__promiseStateFulfilled) {
            const fulfilledValue = __intrinsic__getPromiseInternalField(result, __intrinsic__promiseFieldReactionsOrResult);
            if (fulfilledValue) {
              result = fulfilledValue;
            }
          }
        }

        if (result && __intrinsic__isPromise(result)) {
          result.then(this.processResult, this.handleError);
          return null;
        }

        if (result.done) {
          this.handleClosed();
          return 0;
        } else if (result.value) {
          return result.value;
        } else {
          return -1;
        }
      }

      readMany() {
        if (!this.#ptr) return __intrinsic__throwTypeError("ReadableStreamSink is already closed");
        return this.processResult(this.#reader.readMany());
      }
    };

    const minlength = nativeType + 1;
    if (cached.length < minlength) {
      cached.length = minlength;
    }
    __intrinsic__putByValDirect(cached, nativeType, Prototype);
  }

  if (__intrinsic__isReadableStreamLocked(inputStream)) {
    __intrinsic__throwTypeError("Cannot start reading from a locked stream");
  }

  return new Prototype(inputStream.getReader(), nativePtr);
}).$$capture_end$$;
