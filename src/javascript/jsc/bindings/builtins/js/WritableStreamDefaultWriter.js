/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

function initializeWritableStreamDefaultWriter(stream)
{
    "use strict";

    // stream can be a WritableStream if WritableStreamDefaultWriter constructor is called directly from JS
    // or an InternalWritableStream in other code paths.
    const internalStream = @getInternalWritableStream(stream);
    if (internalStream)
        stream = internalStream;

    if (!@isWritableStream(stream))
        @throwTypeError("WritableStreamDefaultWriter constructor takes a WritableStream");

    @setUpWritableStreamDefaultWriter(this, stream);
    return this;
}

@getter
function closed()
{
    "use strict";

    if (!@isWritableStreamDefaultWriter(this))
        return @Promise.@reject(@makeGetterTypeError("WritableStreamDefaultWriter", "closed"));

    return @getByIdDirectPrivate(this, "closedPromise").@promise;
}

@getter
function desiredSize()
{
    "use strict";

    if (!@isWritableStreamDefaultWriter(this))
        throw @makeThisTypeError("WritableStreamDefaultWriter", "desiredSize");

    if (@getByIdDirectPrivate(this, "stream") === @undefined)
        @throwTypeError("WritableStreamDefaultWriter has no stream");

    return @writableStreamDefaultWriterGetDesiredSize(this);
}

@getter
function ready()
{
    "use strict";

    if (!@isWritableStreamDefaultWriter(this))
        return @Promise.@reject(@makeThisTypeError("WritableStreamDefaultWriter", "ready"));

    return @getByIdDirectPrivate(this, "readyPromise").@promise;
}

function abort(reason)
{
    "use strict";

    if (!@isWritableStreamDefaultWriter(this))
        return @Promise.@reject(@makeThisTypeError("WritableStreamDefaultWriter", "abort"));

    if (@getByIdDirectPrivate(this, "stream") === @undefined)
        return @Promise.@reject(@makeTypeError("WritableStreamDefaultWriter has no stream"));

    return @writableStreamDefaultWriterAbort(this, reason);
}

function close()
{
    "use strict";

    if (!@isWritableStreamDefaultWriter(this))
        return @Promise.@reject(@makeThisTypeError("WritableStreamDefaultWriter", "close"));

    const stream = @getByIdDirectPrivate(this, "stream");
    if (stream === @undefined)
        return @Promise.@reject(@makeTypeError("WritableStreamDefaultWriter has no stream"));

    if (@writableStreamCloseQueuedOrInFlight(stream))
        return @Promise.@reject(@makeTypeError("WritableStreamDefaultWriter is being closed"));
    
    return @writableStreamDefaultWriterClose(this);
}

function releaseLock()
{
    "use strict";

    if (!@isWritableStreamDefaultWriter(this))
        throw @makeThisTypeError("WritableStreamDefaultWriter", "releaseLock");

    const stream = @getByIdDirectPrivate(this, "stream");
    if (stream === @undefined)
        return;

    @assert(@getByIdDirectPrivate(stream, "writer") !== @undefined);
    @writableStreamDefaultWriterRelease(this);
}

function write(chunk)
{
    "use strict";

    if (!@isWritableStreamDefaultWriter(this))
        return @Promise.@reject(@makeThisTypeError("WritableStreamDefaultWriter", "write"));

    if (@getByIdDirectPrivate(this, "stream") === @undefined)
        return @Promise.@reject(@makeTypeError("WritableStreamDefaultWriter has no stream"));

    return @writableStreamDefaultWriterWrite(this, chunk);
}
