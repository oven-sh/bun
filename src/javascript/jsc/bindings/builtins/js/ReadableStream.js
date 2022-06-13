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
         underlyingSource = { };
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
    

    // FIXME: We should introduce https://streams.spec.whatwg.org/#create-readable-stream.
    // For now, we emulate this with underlyingSource with private properties.
    if (@getByIdDirectPrivate(underlyingSource, "pull") !== @undefined) {
        
        const size = @getByIdDirectPrivate(strategy, "size");
        const highWaterMark = @getByIdDirectPrivate(strategy, "highWaterMark");
        @setupReadableStreamDefaultController(this, underlyingSource, size, highWaterMark !== @undefined ? highWaterMark : 1, @getByIdDirectPrivate(underlyingSource, "start"), @getByIdDirectPrivate(underlyingSource, "pull"), @getByIdDirectPrivate(underlyingSource, "cancel"));
        
        return this;
    }

    const type = underlyingSource.type;
    const typeString = @toString(type);

    if (typeString === "bytes") {
        // if (!@readableByteStreamAPIEnabled())
        //     @throwTypeError("ReadableByteStreamController is not implemented");

        if (strategy.highWaterMark === @undefined)
            strategy.highWaterMark = 0;
        if (strategy.size !== @undefined)
            @throwRangeError("Strategy for a ReadableByteStreamController cannot have a size");

        let readableByteStreamControllerConstructor = @ReadableByteStreamController;
        
        @putByIdDirectPrivate(this, "readableStreamController", new @ReadableByteStreamController(this, underlyingSource, strategy.highWaterMark, @isReadableStream));
    } else if (type === @undefined) {
        if (strategy.highWaterMark === @undefined)
            strategy.highWaterMark = 1;
            
        @setupReadableStreamDefaultController(this, underlyingSource, strategy.size, strategy.highWaterMark, underlyingSource.start, underlyingSource.pull, underlyingSource.cancel);
    } else
        @throwRangeError("Invalid type for underlying source");

    return this;
}

@globalPrivate
function readableStreamToArray(stream) {
    "use strict";

    if (!stream || @getByIdDirectPrivate(stream, "state") === @streamClosed) {
        return null;
    }
    var reader = stream.getReader();
    var manyResult = reader.readMany();
    
    async function processManyResult(result) {
        
        if (result.done) {
            return null;
        }

        var chunks = result.value || [];
        
        while (true) {
            var thisResult = await reader.read();
            
            if (thisResult.done) {
                return chunks;
            }
            
            chunks.push(thisResult.value);
        }

        return chunks;
    };


    if (manyResult && @isPromise(manyResult)) {
        return manyResult.@then(processManyResult);
    }

    if (manyResult && manyResult.done) {
        return null;
    }

    return processManyResult(manyResult);
}

@globalPrivate
function readableStreamToText(stream) {
    "use strict";

    // TODO: optimize this to skip the extra ArrayBuffer
    return globalThis.Bun.readableStreamToArrayBuffer(stream).@then(function(arrayBuffer) {
        return new globalThis.TextDecoder().decode(arrayBuffer);
    });
}

@globalPrivate
function readableStreamToJSON(stream) {
    "use strict";

    // TODO: optimize this to skip the extra ArrayBuffer
    return globalThis.Bun.readableStreamToArrayBuffer(stream).@then(function(arrayBuffer) {
        return globalThis.JSON.parse(new globalThis.TextDecoder().decode(arrayBuffer));
    });
}

@globalPrivate
function readableStreamToBlob(stream) {
    "use strict";

 
    const array = @readableStreamToArray(stream);
    if (array === null) {
        return new globalThis.Blob();
    }

    return array.@then(function(chunks) {
        if (chunks === null || chunks.length === 0) {
            return new globalThis.Blob();
        }

        return new globalThis.Blob(chunks);
    });
}

@globalPrivate
function readableStreamToArrayPublic(stream) {
    "use strict";

    if (@getByIdDirectPrivate(stream, "state") === @streamClosed) {
        return [];
    }
    var reader = stream.getReader();

    var manyResult = reader.readMany();

    var processManyResult = (0, (async function(result) {
        if (result.done) {
            return [];
        }

        var chunks = result.value || [];
        
        while (true) {
            var thisResult = await reader.read();
            if (thisResult.done) {
                return chunks;
            }

            chunks.push(thisResult.value);
        }

        return chunks;
    }));


    if (manyResult && @isPromise(manyResult)) {
        return manyResult.then(processManyResult);
    }

    if (manyResult && manyResult.done) {
        return [];
    }

    return processManyResult(manyResult);
}



@globalPrivate
function consumeReadableStream(nativePtr, nativeType, inputStream) {
    "use strict";
    const symbol = Symbol.for("Bun.consumeReadableStreamPrototype");
    var cached =  globalThis[symbol];
    if (!cached) {
        cached = globalThis[symbol] = [];
    }
    var Prototype = cached[nativeType];
    if (Prototype === @undefined) {
        var [doRead, doError, doReadMany, doClose, onClose, deinit] = globalThis[Symbol.for("Bun.lazy")](nativeType);

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

@globalPrivate
function createEmptyReadableStream() {
    var stream = new @ReadableStream({
        pull() {},
        start() {},
        cancel() {},
    });
    @readableStreamClose(stream);
    return stream;
}

@globalPrivate
function createNativeReadableStream(nativePtr, nativeType, autoAllocateChunkSize) {
    "use strict";
    var cached =  globalThis[Symbol.for("Bun.nativeReadableStreamPrototype")] ||= new @Map;
    var Prototype = cached.@get(nativeType);
    if (Prototype === @undefined) {
        var [pull, start, cancel, setClose, deinit] = globalThis[Symbol.for("Bun.lazy")](nativeType);
        var closer = [false];
        var handleResult;
        function handleNativeReadableStreamPromiseResult(val) {
            "use strict";
            var {c, v} = this;
            this.c = @undefined;
            this.v = @undefined;
            handleResult(val, c, v);
        }
     
        handleResult = function handleResult(result, controller, view) {
            "use strict";

            if (result && @isPromise(result)) {
                return result.then(handleNativeReadableStreamPromiseResult.bind({c: controller, v: view}), (err) => controller.error(err));
            } else if (result !== false) {
                if (view && view.byteLength === result) {
                    controller.byobRequest.respondWithNewView(view);
                } else {
                    controller.byobRequest.respond(result);
                }
            }

            if (closer[0] || result === false) {
                @enqueueJob(() => controller.close());
                closer[0] = false;
            }
        };

        Prototype = class NativeReadableStreamSource {
            constructor(tag, autoAllocateChunkSize) {
                this.pull = this.pull_.bind(tag);
                this.cancel = this.cancel_.bind(tag);
                this.autoAllocateChunkSize = autoAllocateChunkSize;
            }

            pull;
            cancel;

            type = "bytes";
            autoAllocateChunkSize = 0;

            static startSync = start;
            
            pull_(controller) {
                closer[0] = false;
                var result;

                const view = controller.byobRequest.view;
                try {
                    result = pull(this, view, closer);
                } catch(err) {
                    return controller.error(err);
                }

                return handleResult(result, controller, view);
            }

            cancel_(reason) {
                cancel(this, reason);
            }

            static registry = new FinalizationRegistry(deinit);
        }
        cached.@set(nativeType, Prototype);
    }
    
    // either returns the chunk size
    // or throws an error
    // should never return a Promise
    const chunkSize = Prototype.startSync(nativePtr, autoAllocateChunkSize);

    // empty file, no need for native back-and-forth on this
    if (chunkSize === 0) {
        return @createEmptyReadableStream();
    }

    var instance = new Prototype(nativePtr, chunkSize);
    Prototype.registry.register(instance, nativePtr);
    var stream = new @ReadableStream(instance);
    @putByIdDirectPrivate(stream, "bunNativeType", nativeType);
    @putByIdDirectPrivate(stream, "bunNativePtr", nativePtr);
    return stream;
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
    if (mode === @undefined)
        return new @ReadableStreamDefaultReader(this);

    // String conversion is required by spec, hence double equals.
    if (mode == 'byob')
        return new @ReadableStreamBYOBReader(this);

    
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
    let options = arguments[1];

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
