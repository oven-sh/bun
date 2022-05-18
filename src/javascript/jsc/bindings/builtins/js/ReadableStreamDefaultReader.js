/*
 * Copyright (C) 2015 Canon Inc.
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

function initializeReadableStreamDefaultReader(stream)
{
    "use strict";

    if (!@isReadableStream(stream))
        @throwTypeError("ReadableStreamDefaultReader needs a ReadableStream");
    if (@isReadableStreamLocked(stream))
        @throwTypeError("ReadableStream is locked");

    @readableStreamReaderGenericInitialize(this, stream);
    @putByIdDirectPrivate(this, "readRequests", []);

    return this;
}

function cancel(reason)
{
    "use strict";

    if (!@isReadableStreamDefaultReader(this))
        return @Promise.@reject(@makeThisTypeError("ReadableStreamDefaultReader", "cancel"));

    if (!@getByIdDirectPrivate(this, "ownerReadableStream"))
        return @Promise.@reject(@makeTypeError("cancel() called on a reader owned by no readable stream"));

    return @readableStreamReaderGenericCancel(this, reason);
}

function read()
{
    "use strict";

    if (!@isReadableStreamDefaultReader(this))
        return @Promise.@reject(@makeThisTypeError("ReadableStreamDefaultReader", "read"));
    if (!@getByIdDirectPrivate(this, "ownerReadableStream"))
        return @Promise.@reject(@makeTypeError("read() called on a reader owned by no readable stream"));

    return @readableStreamDefaultReaderRead(this);
}

function releaseLock()
{
    "use strict";

    if (!@isReadableStreamDefaultReader(this))
        throw @makeThisTypeError("ReadableStreamDefaultReader", "releaseLock");

    if (!@getByIdDirectPrivate(this, "ownerReadableStream"))
        return;

    if (@getByIdDirectPrivate(this, "readRequests").length)
        @throwTypeError("There are still pending read requests, cannot release the lock");

    @readableStreamReaderGenericRelease(this);
}

@getter
function closed()
{
    "use strict";

    if (!@isReadableStreamDefaultReader(this))
        return @Promise.@reject(@makeGetterTypeError("ReadableStreamDefaultReader", "closed"));

    return @getByIdDirectPrivate(this, "closedPromiseCapability").@promise;
}
