/*
 * Copyright (C) 2015 Canon Inc.
 * Copyright (C) 2015 Igalia.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

function initializeReadableStream(underlyingSource, strategy)
{
    "use strict";

     if (underlyingSource === @undefined)
         underlyingSource = { @bunNativeType: 0, @bunNativePtr: 0, @lazy: false };
     if (strategy === @undefined)
         strategy = { };

    if (!@isObject(underlyingSource))
        @throwTypeError("ReadableStream constructor takes an object as first argument");

    if (strategy !== @undefined && !@isObject(strategy))
        @throwTypeError("ReadableStream constructor takes an object as second argument, if any");

    @putByIdDirectPrivate(this, "state", @streamReadable);
    
    @putByIdDirectPrivate(this, "reader", @undefined);
    
    @putByIdDirectPrivate(this, "storedError", @undefined);
    
    @putByIdDirectPrivate(this, "disturbed", false);

    
    // Initialized with null value to enable distinction with undefined case.
    @putByIdDirectPrivate(this, "readableStreamController", null);
    @putByIdDirectPrivate(this, "bunNativeType", @getByIdDirectPrivate(underlyingSource, "bunNativeType") ?? 0);
    @putByIdDirectPrivate(this, "bunNativePtr", @getByIdDirectPrivate(underlyingSource, "bunNativePtr") ?? 0);

    const isDirect = underlyingSource.type === "direct";
    // direct streams are always lazy
    const isUnderlyingSourceLazy = !!underlyingSource.@lazy;
    const isLazy = isDirect || isUnderlyingSourceLazy;
    
    // // FIXME: We should introduce https://streams.spec.whatwg.org/#create-readable-stream.
    // // For now, we emulate this with underlyingSource with private properties.
    if (@getByIdDirectPrivate(underlyingSource, "pull") !== @undefined && !isLazy) {
        const size = @getByIdDirectPrivate(strategy, "size");
        const highWaterMark = @getByIdDirectPrivate(strategy, "highWaterMark");
        @putByIdDirectPrivate(this, "highWaterMark", highWaterMark);
        @putByIdDirectPrivate(this, "underlyingSource", @undefined);
        @setupReadableStreamDefaultController(this, underlyingSource, size, highWaterMark !== @undefined ? highWaterMark : 1, @getByIdDirectPrivate(underlyingSource, "start"), @getByIdDirectPrivate(underlyingSource, "pull"), @getByIdDirectPrivate(underlyingSource, "cancel"));
        
        return this;
    }
    if (isDirect) {
        @putByIdDirectPrivate(this, "underlyingSource", underlyingSource);
        @putByIdDirectPrivate(this, "highWaterMark", @getByIdDirectPrivate(strategy, "highWaterMark"));
        @putByIdDirectPrivate(this, "start", () => @createReadableStreamController(this, underlyingSource, strategy));
    } else if (isLazy) {
        const autoAllocateChunkSize = underlyingSource.autoAllocateChunkSize;
        @putByIdDirectPrivate(this, "highWaterMark", @undefined);
        @putByIdDirectPrivate(this, "underlyingSource", @undefined);
        @putByIdDirectPrivate(this, "highWaterMark", autoAllocateChunkSize || @getByIdDirectPrivate(strategy, "highWaterMark"));

        
        @putByIdDirectPrivate(this, "start", () => {
            const instance = @lazyLoadStream(this, autoAllocateChunkSize);
            if (instance) {
                @createReadableStreamController(this, instance, strategy);
            }
        });
    } else {
        @putByIdDirectPrivate(this, "underlyingSource", @undefined);
        @putByIdDirectPrivate(this, "highWaterMark", @getByIdDirectPrivate(strategy, "highWaterMark"));
        @putByIdDirectPrivate(this, "start", @undefined);
        @createReadableStreamController(this, underlyingSource, strategy);
    }
    

    return this;
}


@linkTimeConstant
function readableStreamToArray(stream) {
    "use strict";

    // this is a direct stream
    var underlyingSource = @getByIdDirectPrivate(stream, "underlyingSource");
    if (underlyingSource !== @undefined) {
        return @readableStreamToArrayDirect(stream, underlyingSource);
    }

    return @readableStreamIntoArray(stream);
}

@linkTimeConstant
function readableStreamToText(stream) {
    "use strict";

    // this is a direct stream
    var underlyingSource = @getByIdDirectPrivate(stream, "underlyingSource");
    if (underlyingSource !== @undefined) {
        return @readableStreamToTextDirect(stream, underlyingSource);
    }

    return @readableStreamIntoText(stream);
}

@linkTimeConstant
function readableStreamToArrayBuffer(stream) {
    "use strict";

    // this is a direct stream
    var underlyingSource = @getByIdDirectPrivate(stream, "underlyingSource");

    if (underlyingSource !== @undefined) {
        return @readableStreamToArrayBufferDirect(stream, underlyingSource);
    }

    return @Bun.readableStreamToArray(stream).@then(@Bun.concatArrayBuffers);
}

@linkTimeConstant
function readableStreamToJSON(stream) {
    "use strict";

    return @Bun.readableStreamToText(stream).@then(globalThis.JSON.parse);
}

@linkTimeConstant
function readableStreamToBlob(stream) {
    "use strict";
    return @Promise.resolve(@Bun.readableStreamToArray(stream)).@then(array => new Blob(array));
}

@linkTimeConstant
function consumeReadableStream(nativePtr, nativeType, inputStream) {
    "use strict";
    const symbol = globalThis.Symbol.for("Bun.consumeReadableStreamPrototype");
    var cached =  globalThis[symbol];
    if (!cached) {
        cached = globalThis[symbol] = [];
    }
    var Prototype = cached[nativeType];
    if (Prototype === @undefined) {
        var [doRead, doError, doReadMany, doClose, onClose, deinit] = globalThis[globalThis.Symbol.for("Bun.lazy")](nativeType);

        Prototype = class NativeReadableStreamSink {
            constructor(reader, ptr) {
                this.#ptr = ptr;
                this.#reader = reader;
                this.#didClose = false;

                this.handleError = this._handleError.bind(this);
                this.handleClosed = this._handleClosed.bind(this);
                this.processResult = this._processResult.bind(this);

                reader.closed.then(this.handleClosed, this.handleError);
            }

            handleError;
            handleClosed;
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

            _handleReadMany({value, done, size}) {
                if (done) {
                    this.handleClosed();
                    return;
                }

                if (this.#didClose) return;
               

                doReadMany(this.#ptr, value, done, size);
            }
        

            read() {
                if (!this.#ptr) return @throwTypeError("ReadableStreamSink is already closed");
                
                return this.processResult(this.#reader.read());
                
            }

            _processResult(result) {
                if (result && @isPromise(result)) {
                    const flags = @getPromiseInternalField(result, @promiseFieldFlags);
                    if (flags & @promiseStateFulfilled) {
                        const fulfilledValue = @getPromiseInternalField(result, @promiseFieldReactionsOrResult);
                        if (fulfilledValue) {
                            result = fulfilledValue;
                        }
                    }
                }

                if (result && @isPromise(result)) {
                    result.then(this.processResult, this.handleError);
                    return null;
                }

                if (result.done) {
                    this.handleClosed();
                    return 0;
                } else if (result.value) {
                    return result.value;
                }  else {
                    return -1;
                }

                
            }

            readMany() {
                if (!this.#ptr) return @throwTypeError("ReadableStreamSink is already closed");
                return this.processResult(this.#reader.readMany());
            }

            
        };

        const minlength = nativeType + 1;
        if (cached.length < minlength) {
            cached.length = minlength;
        }
        @putByValDirect(cached, nativeType, Prototype);
    }

    if (@isReadableStreamLocked(inputStream)) {
        @throwTypeError("Cannot start reading from a locked stream");
    }

   return new Prototype(inputStream.getReader(), nativePtr);
}

@linkTimeConstant
function createEmptyReadableStream() {
    "use strict";

    var stream = new @ReadableStream({
        pull() {},
    });
    @readableStreamClose(stream);
    return stream;
}

@linkTimeConstant
function createNativeReadableStream(nativePtr, nativeType, autoAllocateChunkSize) {
    "use strict";
    return new @ReadableStream({
        @lazy: true,
        @bunNativeType: nativeType,
        @bunNativePtr: nativePtr,
        autoAllocateChunkSize: autoAllocateChunkSize,
    });
}

function cancel(reason)
{
    "use strict";

    if (!@isReadableStream(this))
        return @Promise.@reject(@makeThisTypeError("ReadableStream", "cancel"));

    if (@isReadableStreamLocked(this))
        return @Promise.@reject(@makeTypeError("ReadableStream is locked"));

    return @readableStreamCancel(this, reason);
}

function getReader(options)
{
    "use strict";

    if (!@isReadableStream(this))
        throw @makeThisTypeError("ReadableStream", "getReader");

    const mode = @toDictionary(options, { }, "ReadableStream.getReader takes an object as first argument").mode;
    if (mode === @undefined) {
        var start_ = @getByIdDirectPrivate(this, "start");
        if (start_) {
            @putByIdDirectPrivate(this, "start", @undefined);
            start_();
        }
        
        return new @ReadableStreamDefaultReader(this);
    }
    // String conversion is required by spec, hence double equals.
    if (mode == 'byob') {
        return new @ReadableStreamBYOBReader(this);
    }

    
    @throwTypeError("Invalid mode is specified");
}

function pipeThrough(streams, options)
{
    "use strict";

    const transforms = streams;

    const readable = transforms["readable"];
    if (!@isReadableStream(readable))
        throw @makeTypeError("readable should be ReadableStream");

    const writable = transforms["writable"];
    const internalWritable = @getInternalWritableStream(writable);
    if (!@isWritableStream(internalWritable))
        throw @makeTypeError("writable should be WritableStream");

    let preventClose = false;
    let preventAbort = false;
    let preventCancel = false;
    let signal;
    if (!@isUndefinedOrNull(options)) {
        if (!@isObject(options))
            throw @makeTypeError("options must be an object");

        preventAbort = !!options["preventAbort"];
        preventCancel = !!options["preventCancel"];
        preventClose = !!options["preventClose"];

        signal = options["signal"];
        if (signal !== @undefined && !@isAbortSignal(signal))
            throw @makeTypeError("options.signal must be AbortSignal");
    }

    if (!@isReadableStream(this))
        throw @makeThisTypeError("ReadableStream", "pipeThrough");

    if (@isReadableStreamLocked(this))
        throw @makeTypeError("ReadableStream is locked");

    if (@isWritableStreamLocked(internalWritable))
        throw @makeTypeError("WritableStream is locked");

    @readableStreamPipeToWritableStream(this, internalWritable, preventClose, preventAbort, preventCancel, signal);

    return readable;
}

function pipeTo(destination)
{
    "use strict";

    // FIXME: https://bugs.webkit.org/show_bug.cgi?id=159869.
    // Built-in generator should be able to parse function signature to compute the function length correctly.
    let options = @argument(1);

    let preventClose = false;
    let preventAbort = false;
    let preventCancel = false;
    let signal;
    if (!@isUndefinedOrNull(options)) {
        if (!@isObject(options))
            return @Promise.@reject(@makeTypeError("options must be an object"));

        try {
            preventAbort = !!options["preventAbort"];
            preventCancel = !!options["preventCancel"];
            preventClose = !!options["preventClose"];

            signal = options["signal"];
        } catch(e) {
            return @Promise.@reject(e);
        }

        if (signal !== @undefined && !@isAbortSignal(signal))
            return @Promise.@reject(@makeTypeError("options.signal must be AbortSignal"));
    }

    const internalDestination = @getInternalWritableStream(destination);
    if (!@isWritableStream(internalDestination))
        return @Promise.@reject(@makeTypeError("ReadableStream pipeTo requires a WritableStream"));

    if (!@isReadableStream(this))
        return @Promise.@reject(@makeThisTypeError("ReadableStream", "pipeTo"));

    if (@isReadableStreamLocked(this))
        return @Promise.@reject(@makeTypeError("ReadableStream is locked"));

    if (@isWritableStreamLocked(internalDestination))
        return @Promise.@reject(@makeTypeError("WritableStream is locked"));

    return @readableStreamPipeToWritableStream(this, internalDestination, preventClose, preventAbort, preventCancel, signal);
}

function tee()
{
    "use strict";

    if (!@isReadableStream(this))
        throw @makeThisTypeError("ReadableStream", "tee");

    return @readableStreamTee(this, false);
}

@getter
function locked()
{
    "use strict";

    if (!@isReadableStream(this))
        throw @makeGetterTypeError("ReadableStream", "locked");

    return @isReadableStreamLocked(this);
}

function values(options) {
    "use strict";
    var prototype = this?.constructor?.prototype;
    if (!prototype) {
        return @undefined;
    }
    @readableStreamDefineLazyIterators(prototype);
    return prototype.values.@call(this, options);
}

@linkTimeConstant
function lazyAsyncIterator() {
    "use strict";
    var prototype = this?.constructor?.prototype;
    if (!prototype) {
        return @undefined;
    }
    @readableStreamDefineLazyIterators(prototype);
    return prototype[globalThis.Symbol.asyncIterator].@call(this);
}