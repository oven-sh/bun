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

function initializeReadableStreamDefaultController(stream, underlyingSource, size, highWaterMark)
{
    "use strict";

    if (arguments.length !== 5 && arguments[4] !== @isReadableStream)
        @throwTypeError("ReadableStreamDefaultController constructor should not be called directly");

    return @privateInitializeReadableStreamDefaultController.@call(this, stream, underlyingSource, size, highWaterMark);
}

function enqueue(chunk)
{
    "use strict";

    if (!@isReadableStreamDefaultController(this))
        throw @makeThisTypeError("ReadableStreamDefaultController", "enqueue");

    if (!@readableStreamDefaultControllerCanCloseOrEnqueue(this))
        @throwTypeError("ReadableStreamDefaultController is not in a state where chunk can be enqueued");

    return @readableStreamDefaultControllerEnqueue(this, chunk);
}

function error(error)
{
    "use strict";

    if (!@isReadableStreamDefaultController(this))
        throw @makeThisTypeError("ReadableStreamDefaultController", "error");

    @readableStreamDefaultControllerError(this, error);
}

function close()
{
    "use strict";

    if (!@isReadableStreamDefaultController(this))
        throw @makeThisTypeError("ReadableStreamDefaultController", "close");

    if (!@readableStreamDefaultControllerCanCloseOrEnqueue(this))
        @throwTypeError("ReadableStreamDefaultController is not in a state where it can be closed");

    @readableStreamDefaultControllerClose(this);
}

@getter
function desiredSize()
{
    "use strict";

    if (!@isReadableStreamDefaultController(this))
        throw @makeGetterTypeError("ReadableStreamDefaultController", "desiredSize");

    return @readableStreamDefaultControllerGetDesiredSize(this);
}

