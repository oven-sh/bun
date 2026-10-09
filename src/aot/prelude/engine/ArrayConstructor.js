/*
 * Copyright (C) 2015, 2016 Apple Inc. All rights reserved.
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

export function from(items /*, mapFn, thisArg */)
{
    "use strict";

    var mapFn = $argument(1);

    var thisArg;

    if (mapFn !== undefined) {
        if (!$isCallable(mapFn))
            throw new TypeError("Array.from requires that the second argument, when provided, be a function");

        thisArg = $argument(2);
    }

    var arrayLike = $toObject(items, "Array.from requires an array-like object - not null or undefined");

    if (mapFn === undefined) {
        var fastResult = $arrayFromFastWithoutMapFn(this, arrayLike);
        if (fastResult)
            return fastResult;
    }

    var iteratorMethod = items[Symbol.iterator];
    if (!$isUndefinedOrNull(iteratorMethod)) {
        if (!$isCallable(iteratorMethod))
            throw new TypeError("Array.from requires that the property of the first argument, items[Symbol.iterator], when exists, be a function");

        var result = this !== $Array && $isConstructor(this) ? new this() : [];

        var k = 0;
        var iterator = iteratorMethod.$call(items);

        // Since for-of loop once more looks up the @@iterator property of a given iterable,
        // it could be observable if the user defines a getter for @@iterator.
        // To avoid this situation, we define a wrapper object that @@iterator just returns a given iterator.
        var wrapper = {
            [Symbol.iterator]: function () { return iterator; }
        };

        for (var value of wrapper) {
            if (k >= 9007199254740991)
                throw new TypeError("Length exceeded the maximum array length");
            if (mapFn === undefined)
                $putByValDirect(result, k, value);
            else
                $putByValDirect(result, k, thisArg === undefined ? mapFn(value, k) : mapFn.$call(thisArg, value, k));
            k += 1;
        }

        result.length = k;
        return result;
    }

    var arrayLikeLength = $toLength(arrayLike.length);

    var result = this !== $Array && $isConstructor(this) ? new this(arrayLikeLength) : $newArrayWithSize(arrayLikeLength);

    var k = 0;
    while (k < arrayLikeLength) {
        var value = arrayLike[k];
        if (mapFn === undefined)
            $putByValDirect(result, k, value);
        else
            $putByValDirect(result, k, thisArg === undefined ? mapFn(value, k) : mapFn.$call(thisArg, value, k));
        k += 1;
    }

    result.length = arrayLikeLength;
    return result;
}

$linkTimeConstant;
$visibility = "PrivateRecursive";
export async function defaultAsyncFromAsyncIterator(iterator, mapFn, thisArg)
{
    "use strict";

    var result = this !== $Array && $isConstructor(this) ? new this() : [];

    var k = 0;

    // Since for-of loop once more looks up the @@iterator property of a given iterable,
    // it could be observable if the user defines a getter for @@iterator.
    // To avoid this situation, we define a wrapper object that @@iterator just returns a given iterator.
    var wrapper = {
        [Symbol.asyncIterator]: function () { return iterator; }
    };

    for await (var value of wrapper) {
        if (k >= 9007199254740991)
            throw new TypeError("Length exceeded the maximum array length");
        if (mapFn === undefined)
            $putByValDirect(result, k, value);
        else
            $putByValDirect(result, k, await (thisArg === undefined ? mapFn(value, k) : mapFn.$call(thisArg, value, k)));
        k += 1;
    }

    result.length = k;
    return result;
}

$linkTimeConstant;
$visibility = "PrivateRecursive";
export async function defaultAsyncFromAsyncArrayLike(asyncItems, mapFn, thisArg)
{
    "use strict";

    var arrayLike = $toObject(asyncItems, "Array.fromAsync requires an array-like object - not null or undefined");

    var arrayLikeLength = $toLength(arrayLike.length);

    var result = this !== $Array && $isConstructor(this) ? new this(arrayLikeLength) : $newArrayWithSize(arrayLikeLength);

    var k = 0;
    while (k < arrayLikeLength) {
        var value = await arrayLike[k];
        if (mapFn === undefined)
            $putByValDirect(result, k, value);
        else
            $putByValDirect(result, k, await (thisArg === undefined ? mapFn(value, k) : mapFn.$call(thisArg, value, k)));
        k += 1;
    }

    result.length = arrayLikeLength;
    return result;
}

export function fromAsync(asyncItems  /*, mapFn, thisArg */)
{
    "use strict";

    try {
        var mapFn = $argument(1);

        var thisArg;

        if (mapFn !== undefined) {
            if (!$isCallable(mapFn))
                throw new TypeError("Array.fromAsync requires that the second argument, when provided, be a function");

            thisArg = $argument(2);
        }

        var usingSyncIterator;
        var usingAsyncIterator = asyncItems[Symbol.asyncIterator];
        if (!$isUndefinedOrNull(usingAsyncIterator)) {
            if (!$isCallable(usingAsyncIterator))
                throw new TypeError("Array.fromAsync requires that the property of the first argument, items[Symbol.asyncIterator], when exists, be a function");
        } else {
            usingSyncIterator = asyncItems[Symbol.iterator];
            if (!$isUndefinedOrNull(usingSyncIterator)) {
                if (!$isCallable(usingSyncIterator))
                    throw new TypeError("Array.fromAsync requires that the property of the first argument, items[Symbol.iterator], when exists, be a function");
            }
        }

        if (!$isUndefinedOrNull(usingAsyncIterator))
            return $defaultAsyncFromAsyncIterator.$call(this, usingAsyncIterator.$call(asyncItems), mapFn, thisArg);

        if (!$isUndefinedOrNull(usingSyncIterator)) {
            var iterator = usingSyncIterator.$call(asyncItems);
            return $defaultAsyncFromAsyncIterator.$call(this, $asyncFromSyncIteratorCreate(iterator), mapFn, thisArg);
        }

        return $defaultAsyncFromAsyncArrayLike.$call(this, asyncItems, mapFn, thisArg);
    } catch (reason) {
        var promise = $newPromise();
        $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, reason);
        return promise;
    }
}
