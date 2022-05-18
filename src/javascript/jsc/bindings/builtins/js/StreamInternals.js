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

// @internal

function markPromiseAsHandled(promise)
{
    "use strict";

    @assert(@isPromise(promise));
    @putPromiseInternalField(promise, @promiseFieldFlags, @getPromiseInternalField(promise, @promiseFieldFlags) | @promiseFlagsIsHandled);
}

function shieldingPromiseResolve(result)
{
    "use strict";

    const promise = @Promise.@resolve(result);
    if (promise.@then === @undefined)
        promise.@then = @Promise.prototype.@then;
    return promise;
}

function promiseInvokeOrNoopMethodNoCatch(object, method, args)
{
    "use strict";

    if (method === @undefined)
        return @Promise.@resolve();
    return @shieldingPromiseResolve(method.@apply(object, args));
}

function promiseInvokeOrNoopNoCatch(object, key, args)
{
    "use strict";

    return @promiseInvokeOrNoopMethodNoCatch(object, object[key], args);
}

function promiseInvokeOrNoopMethod(object, method, args)
{
    "use strict";

    try {
        return @promiseInvokeOrNoopMethodNoCatch(object, method, args);
    }
    catch(error) {
        return @Promise.@reject(error);
    }
}

function promiseInvokeOrNoop(object, key, args)
{
    "use strict";

    try {
        return @promiseInvokeOrNoopNoCatch(object, key, args);
    }
    catch(error) {
        return @Promise.@reject(error);
    }
}

function promiseInvokeOrFallbackOrNoop(object, key1, args1, key2, args2)
{
    "use strict";

    try {
        const method = object[key1];
        if (method === @undefined)
            return @promiseInvokeOrNoopNoCatch(object, key2, args2);
        return @shieldingPromiseResolve(method.@apply(object, args1));
    }
    catch(error) {
        return @Promise.@reject(error);
    }
}

function validateAndNormalizeQueuingStrategy(size, highWaterMark)
{
    "use strict";

    if (size !== @undefined && typeof size !== "function")
        @throwTypeError("size parameter must be a function");

    const normalizedStrategy = {
        size: size,
        highWaterMark: @toNumber(highWaterMark)
    };

    if (@isNaN(normalizedStrategy.highWaterMark) || normalizedStrategy.highWaterMark < 0)
        @throwRangeError("highWaterMark value is negative or not a number");

    return normalizedStrategy;
}

function newQueue()
{
    "use strict";

    return { content: [], size: 0 };
}

function dequeueValue(queue)
{
    "use strict";

    const record = queue.content.@shift();
    queue.size -= record.size;
    // As described by spec, below case may occur due to rounding errors.
    if (queue.size < 0)
        queue.size = 0;
    return record.value;
}

function enqueueValueWithSize(queue, value, size)
{
    "use strict";

    size = @toNumber(size);
    if (!@isFinite(size) || size < 0)
        @throwRangeError("size has an incorrect value");
    @arrayPush(queue.content, { value, size });
    queue.size += size;
}

function peekQueueValue(queue)
{
    "use strict";

    @assert(queue.content.length > 0);

    return queue.content[0].value;
}

function resetQueue(queue)
{
    "use strict";

    @assert("content" in queue);
    @assert("size" in queue);
    queue.content = [];
    queue.size = 0;
}

function extractSizeAlgorithm(strategy)
{
    if (!("size" in strategy))
        return () => 1;
    const sizeAlgorithm = strategy["size"];
    if (typeof sizeAlgorithm !== "function")
        @throwTypeError("strategy.size must be a function");

    return (chunk) => { return sizeAlgorithm(chunk); };
}

function extractHighWaterMark(strategy, defaultHWM)
{
    if (!("highWaterMark" in strategy))
        return defaultHWM;
    const highWaterMark = strategy["highWaterMark"];
    if (@isNaN(highWaterMark) || highWaterMark < 0)
        @throwRangeError("highWaterMark value is negative or not a number");

    return @toNumber(highWaterMark);
}

function extractHighWaterMarkFromQueuingStrategyInit(init)
{
    "use strict";

    if (!@isObject(init))
        @throwTypeError("QueuingStrategyInit argument must be an object.");
    const {highWaterMark} = init;
    if (highWaterMark === @undefined)
        @throwTypeError("QueuingStrategyInit.highWaterMark member is required.");

    return @toNumber(highWaterMark);
}

function createFulfilledPromise(value)
{
    const promise = @newPromise();
    @fulfillPromise(promise, value);
    return promise;
}

function toDictionary(value, defaultValue, errorMessage)
{
    if (value === @undefined || value === null)
        return defaultValue;
    if (!@isObject(value))
        @throwTypeError(errorMessage);
    return value;
}
