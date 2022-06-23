/*
 * Copyright (C) 2016 Canon Inc.
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

function initializeReadableByteStreamController(stream, underlyingByteSource, highWaterMark)
{
    "use strict";

    if (arguments.length !== 4 && arguments[3] !== @isReadableStream)
        @throwTypeError("ReadableByteStreamController constructor should not be called directly");

    return @privateInitializeReadableByteStreamController.@call(this, stream, underlyingByteSource, highWaterMark);
}

function enqueue(chunk)
{
    "use strict";

    if (!@isReadableByteStreamController(this))
        throw @makeThisTypeError("ReadableByteStreamController", "enqueue");

    if (@getByIdDirectPrivate(this, "closeRequested"))
        @throwTypeError("ReadableByteStreamController is requested to close");

    if (@getByIdDirectPrivate(@getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== @streamReadable)
        @throwTypeError("ReadableStream is not readable");

    if (!@isObject(chunk) || !@ArrayBuffer.@isView(chunk))
        @throwTypeError("Provided chunk is not a TypedArray");

    return @readableByteStreamControllerEnqueue(this, chunk);
}

function error(error)
{
    "use strict";

    if (!@isReadableByteStreamController(this))
        throw @makeThisTypeError("ReadableByteStreamController", "error");

    if (@getByIdDirectPrivate(@getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== @streamReadable)
        @throwTypeError("ReadableStream is not readable");

    @readableByteStreamControllerError(this, error);
}

function close()
{
    "use strict";

    if (!@isReadableByteStreamController(this))
        throw @makeThisTypeError("ReadableByteStreamController", "close");

    if (@getByIdDirectPrivate(this, "closeRequested"))
        @throwTypeError("Close has already been requested");

    if (@getByIdDirectPrivate(@getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== @streamReadable)
        @throwTypeError("ReadableStream is not readable");

    @readableByteStreamControllerClose(this);
}

@getter
function byobRequest()
{
    "use strict";

    if (!@isReadableByteStreamController(this))
        throw @makeGetterTypeError("ReadableByteStreamController", "byobRequest");

    
    var request = @getByIdDirectPrivate(this, "byobRequest");
    if (request === @undefined) {
        var pending = @getByIdDirectPrivate(this, "pendingPullIntos");
        const firstDescriptor = pending.peek();
        if (firstDescriptor) {
            const view = new @Uint8Array(firstDescriptor.buffer,
            firstDescriptor.byteOffset + firstDescriptor.bytesFilled,
            firstDescriptor.byteLength - firstDescriptor.bytesFilled);
            @putByIdDirectPrivate(this, "byobRequest", new @ReadableStreamBYOBRequest(this, view, @isReadableStream));
        }
    }

    return @getByIdDirectPrivate(this, "byobRequest");
}

@getter
function desiredSize()
{
    "use strict";

    if (!@isReadableByteStreamController(this))
        throw @makeGetterTypeError("ReadableByteStreamController", "desiredSize");

    return @readableByteStreamControllerGetDesiredSize(this);
}
