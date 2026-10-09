/*
 * Copyright (C) 2015-2022 Apple Inc. All rights reserved.
 * Copyright (C) 2022 Jarred Sumner. All rights reserved.
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

export function from(items /* [ , mapfn [ , thisArg ] ] */)
{
    "use strict";

    if (!$isConstructor(this))
        throw new TypeError("TypedArray.from requires |this| to be a constructor");

    var mapFn = $argument(1);
    var thisArg;
    if (mapFn !== undefined) {
        if (!$isCallable(mapFn))
            throw new TypeError("TypedArray.from requires that the second argument, when provided, be a function");

        thisArg = $argument(2);
    }

    var arrayLike = $toObject(items, "TypedArray.from requires an array-like object - not null or undefined");

    if (mapFn === undefined) {
        var fastResult = $typedArrayFromFast(this, arrayLike);
        if (fastResult)
            return fastResult;
    }

    var iteratorMethod = items[Symbol.iterator];
    if (!$isUndefinedOrNull(iteratorMethod)) {
        if (!$isCallable(iteratorMethod))
            throw new TypeError("TypedArray.from requires that the property of the first argument, items[Symbol.iterator], when exists, be a function");

        var accumulator = [];

        var count = 0;
        var iterator = iteratorMethod.$call(items);

        // Since for-of loop once more looks up the @@iterator property of a given iterable,
        // it could be observable if the user defines a getter for @@iterator.
        // To avoid this situation, we define a wrapper object that @@iterator just returns a given iterator.
        var wrapper = {};
        wrapper[Symbol.iterator] = function() { return iterator; }

        for (var value of wrapper) {
            $putByValDirect(accumulator, count, value);
            count++;
        }

        var result = new this(count);
        if ($typedArrayLength(result) < count)
            throw new TypeError("TypedArray.from constructed typed array of insufficient length");

        for (var k = 0; k < count; k++) {
            var value = accumulator[k];
            if (mapFn === undefined)
                result[k] = value;
            else
                result[k] = thisArg === undefined ? mapFn(value, k) : mapFn.$call(thisArg, value, k);
        }

        return result;
    }

    var arrayLikeLength = $toLength(arrayLike.length);

    var result = new this(arrayLikeLength);
    if ($typedArrayLength(result) < arrayLikeLength)
        throw new TypeError("TypedArray.from constructed typed array of insufficient length");

    for (var k = 0; k < arrayLikeLength; k++) {
        if ($isTypedArrayView(arrayLike) && ($isTypedArrayOutOfBounds(arrayLike) || k >= $typedArrayLength(arrayLike)))
            break;
        var value = arrayLike[k];
        if (mapFn === undefined)
            result[k] = value;
        else {
            var mapped = thisArg === undefined ? mapFn(value, k) : mapFn.$call(thisArg, value, k);
            if ($isTypedArrayView(result) && ($isTypedArrayOutOfBounds(result) || k >= $typedArrayLength(result)))
                break;
            result[k] = mapped;
        }
    }

    return result;
}
