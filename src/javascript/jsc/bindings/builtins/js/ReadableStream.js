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

    const isDirect = underlyingSource.type === "direct";
    // direct streams are always lazy
    const isLazy = isDirect || !!underlyingSource.@lazy;
    

    @putByIdDirectPrivate(this, "direct", isDirect);
    
    // FIXME: We should introduce https://streams.spec.whatwg.org/#create-readable-stream.
    // For now, we emulate this with underlyingSource with private properties.
    if (@getByIdDirectPrivate(underlyingSource, "pull") !== @undefined) {
        @putByIdDirectPrivate(this, "underlyingSource", @undefined);
        const size = @getByIdDirectPrivate(strategy, "size");
        const highWaterMark = @getByIdDirectPrivate(strategy, "highWaterMark");
        @setupReadableStreamDefaultController(this, underlyingSource, size, highWaterMark !== @undefined ? highWaterMark : 1, @getByIdDirectPrivate(underlyingSource, "start"), @getByIdDirectPrivate(underlyingSource, "pull"), @getByIdDirectPrivate(underlyingSource, "cancel"));
        
        return this;
    }

    if (isLazy) {
        
        if (isDirect) {
            if ("start" in underlyingSource && typeof underlyingSource.start === "function")
                @throwTypeError("\"start\" for direct streams are not implemented yet");
        

            @putByIdDirectPrivate(this, "underlyingSource", underlyingSource);
            @putByIdDirectPrivate(this, "start", () => @createReadableStreamController(this, underlyingSource, strategy, true));
        } else {
            @putByIdDirectPrivate(this, "underlyingSource", @undefined);
            const autoAllocateChunkSize = underlyingSource.autoAllocateChunkSize;
            @putByIdDirectPrivate(this, "start", () => @lazyLoadStream(this, autoAllocateChunkSize));
        }
    } else {
        @putByIdDirectPrivate(this, "underlyingSource", @undefined);
        @putByIdDirectPrivate(this, "start", @undefined);
        @createReadableStreamController.@call(this, underlyingSource, strategy, false);
    }
    

    return this;
}

function handleDirectStreamError(e) {
    "use strict";

    var controller = this;
    var sink = controller.@sink;
    if (sink) {
        @putByIdDirectPrivate(controller "sink", @undefined);
        try {
            sink.close(e);
        } catch (f) {}
    }

    this.error = this.drain = this.write = this.close = this.end = @onReadableStreamDirectControllerClosed;

    if (typeof this.@underlyingSource.close === 'function') {
        try {
            this.@underlyingSource.close.@call(this.@underlyingSource, e);
        } catch (e) {
        }
    }

    try {
        var pend = controller._pendingRead;
        if (pend) {
            controller._pendingRead = @undefined;
            @rejectPromise(pend, e);
        }
    } catch (f) {}
   var stream = controller.@controlledReadableStream;
    if (stream) @readableStreamError(stream, e);
}

function handleDirectStreamErrorReject(e) {
    @handleDirectStreamError.@call(this, e);
    return @Promise.@reject(e);
}

function onPullDirectStream(controller)
{
    
    "use strict";

    var stream = controller.@controlledReadableStream;
    if (!stream || @getByIdDirectPrivate(stream, "state") !== @streamReadable)
        return;

    // pull is in progress
    // this is a recursive call
    // ignore it
    if (controller._deferClose === -1) {
        return;
    }

    
    controller._deferClose = -1;
    controller._deferDrain = -1;
    var deferClose;
    var deferDrain;

    // Direct streams allow @pull to be called multiple times, unlike the spec.
    // Backpressure is handled by the destination, not by the underlying source.
    // In this case, we rely on the heuristic that repeatedly draining in the same tick
    // is bad for performance
    // this code is only run when consuming a direct stream from JS
    // without the HTTP server or anything else
    try {
        var result = controller.@underlyingSource.@pull(
            controller,
        );

        if (result && @isPromise(result)) {
            if (controller._handleError === @undefined) {
                controller._handleError = @handleDirectStreamErrorReject.@bind(controller);
            }

            @Promise.prototype.@catch.@call(result, controller._handleError);
        }
    } catch(e) {
        return @handleDirectStreamErrorReject.@call(controller, e);
    } finally {
        deferDrain = controller._deferClose;
        deferClose = controller._deferDrain;
        controller._deferDrain = 0;
        controller._deferClose = 0;
        
    }
    
   
    var promiseToReturn;
   

    if (controller._pendingRead === @undefined) {
        controller._pendingRead = promiseToReturn = @newPromise();
    } else {
        promiseToReturn = @readableStreamAddReadRequest(stream);
    }

    // they called close during @pull()
    // we delay that 
    if (deferClose === 1) {
        var reason = controller._deferCloseReason;
        controller._deferCloseReason = @undefined;
        @onCloseDirectStream.@call(controller, reason);
        return promiseToReturn;
    }

    // not done, but they called drain()
    if (deferDrain === 1) {
        @onDrainDirectStream.@call(controller);
    }
    

    return promiseToReturn;
}

function noopDoneFunction() {
    return @Promise.@resolve({value: @undefined, done: true});
}

function onReadableStreamDirectControllerClosed(reason)
{
    "use strict";
    @throwTypeError("ReadableStreamDirectController is now closed");
}

function onCloseDirectStream(reason)
{
    "use strict";
    var stream = this.@controlledReadableStream;
    if (!stream || @getByIdDirectPrivate(stream, "state") !== @streamReadable)
        return;

    if (this._deferClose !== 0) {
        this._deferClose = 1;
        this._deferCloseReason = reason;
        return;
    }

    @putByIdDirectPrivate(stream, "state", @streamClosing);
    if (typeof this.@underlyingSource.close === 'function') {
        try {
            this.@underlyingSource.close.@call(this.@underlyingSource, reason);
        } catch (e) {
            
        }
    }

    var drained;
    try {
        drained = this.@sink.end();
        @putByIdDirectPrivate(this, "sink", @undefined);
    } catch (e) {
        if (this._pendingRead) {
            var read = this._pendingRead;
            this._pendingRead = @undefined;
            @rejectPromise(read, e);
        }
        @readableStreamError(stream, e);
        return;
    }

    this.error = this.drain = this.write = this.close = this.end = @onReadableStreamDirectControllerClosed;

    var reader = @getByIdDirectPrivate(stream, "reader");

    if (reader && @isReadableStreamDefaultReader(reader)) {
        var _pendingRead = this._pendingRead;
        if (_pendingRead && @isPromise(_pendingRead) && drained?.byteLength) {
            this._pendingRead = @undefined;
            @fulfillPromise(_pendingRead, {value: drained, done: false});
            @readableStreamClose(stream);
            return;
        }
    }

    if (drained?.byteLength) {
        var requests = @getByIdDirectPrivate(reader, "readRequests");
        if (requests?.isNotEmpty()) {
            @readableStreamFulfillReadRequest(stream, drained, false);
            @readableStreamClose(stream);
            return;
        }
        
        @putByIdDirectPrivate(stream, "state", @streamReadable);
        this.@pull = () => {
            var thisResult = @createFulfilledPromise({value: drained, done: false});
            drained = @undefined;
            @readableStreamClose(stream);
            stream = @undefined;
            return thisResult;
        };
    } else if (this._pendingRead) {
        var read = this._pendingRead;
        this._pendingRead = @undefined;
        @putByIdDirectPrivate(this, "pull", @noopDoneFunction);
        @fulfillPromise(read, {value: @undefined, done: true});
    }

    @readableStreamClose(stream);
}

function onDrainDirectStream()
{
    "use strict";

    var straem = this.@controlledReadableStream;
    var reader = @getByIdDirectPrivate(stream, "reader");
    if (!reader || !@isReadableStreamDefaultReader(reader)) {
        return;
    }

    var _pendingRead = this._pendingRead;
    this._pendingRead = @undefined;
    if (_pendingRead && @isPromise(_pendingRead)) {
        var drained = this.@sink.drain();
        if (drained?.byteLength) {
            this._pendingRead = @getByIdDirectPrivate(stream, "readRequests")?.shift();
            @fulfillPromise(_pendingRead, {value: drained, done: false});
        } else {
            this._pendingRead = _pendingRead;
        }
    } else if (@getByIdDirectPrivate(stream, "readRequests")?.isNotEmpty()) {
        var drained = this.@sink.drain();
        if (drained?.byteLength) {
            @readableStreamFulfillReadRequest(stream, drained, false);
        }
    } else if (this._deferDrain === -1) {
        this._deferDrain = 1;
    }
    
}

function initializeArrayBufferStream(underlyingSource, highWaterMark)
{
    "use strict";

    // This is the fallback implementation for direct streams
    // When we don't know what the destination type is
    // We assume it is a Uint8Array.
    var sink = new globalThis.Bun.ArrayBufferSink(highWaterMark ? {highWaterMark, stream: true, asUint8Array: true} : {stream: true, asUint8Array: true});
    var controller = {
        @underlyingSource: underlyingSource,
        @pull: @onPullDirectStream,
        @controlledReadableStream: this,
        @sink: sink,
        close: @onCloseDirectStream,
        write: sink.write.@bind(sink),
        end: @onCloseDirectStream,
        drain: @onDrainDirectStream,
        _pendingRead: @undefined,
        _deferClose: 0,
        _deferDrain: 0,
        _deferCloseReason: @undefined,
        _handleError: @undefined,
    };
   
    
    @putByIdDirectPrivate(this, "readableStreamController", controller);
    
}

function createReadableStreamController(underlyingSource, strategy, fromLazy) {
    if (fromLazy) {
        @putByIdDirectPrivate(this, "start", @undefined);
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

        @putByIdDirectPrivate(this, "readableStreamController", new @ReadableByteStreamController(this, underlyingSource, strategy.highWaterMark, @isReadableStream));
     } else if (typeString === "direct") {
        if (strategy.size !== @undefined)
            @throwRangeError("Strategy for a ReadableDirectStreamController cannot have a size");

        var highWaterMark = strategy.highWaterMark;
        @initializeArrayBufferStream.@call(this, underlyingSource, highWaterMark);  
     } else if (type === @undefined) {
        if (strategy.highWaterMark === @undefined)
            strategy.highWaterMark = 1;
            
        @setupReadableStreamDefaultController(this, underlyingSource, strategy.size, strategy.highWaterMark, underlyingSource.start, underlyingSource.pull, underlyingSource.cancel);
    } else
        @throwRangeError("Invalid type for underlying source");

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
    });
    @readableStreamClose(stream);
    return stream;
}

function lazyLoadStream(stream, autoAllocateChunkSize) {
    "use strict";

    @putByIdDirectPrivate(stream, "start", @undefined);
    var bunNativeType = @getByIdDirectPrivate(stream, "bunNativeType");
    var bunNativePtr = @getByIdDirectPrivate(stream, "bunNativePtr");

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
        @readableStreamClose(stream);
        return;
    }

    var instance = new Prototype(nativePtr, chunkSize);
    Prototype.registry.register(instance, nativePtr);
    @createReadableStreamController.@call(stream, instance, @undefined, true);
}

@globalPrivate
function createNativeReadableStream(nativePtr, nativeType, autoAllocateChunkSize) {
    "use strict";
    stream = new @ReadableStream({
        @lazy: true,
        autoAllocateChunkSize: autoAllocateChunkSize,
    });
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
    if (mode == 'byob') {
        var controller = @getByIdDirectPrivate(this, "controller");
        if (@isReadableStreamDefaultController(controller)) {
            @readableStreamDefaultControllerStart(controller);
        } else {
            @readableStreamByteStreamControllerStart(controller);
        }

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
