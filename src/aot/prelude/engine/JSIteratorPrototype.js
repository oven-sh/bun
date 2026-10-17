/*
 * Copyright (C) 2024 Sosuke Suzuki <aosukeke@gmail.com>.
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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

// https://tc39.es/ecma262/#sec-iterator.prototype.map
export function map(mapper)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.map requires that |this| be an Object.");

    if (!$isCallable(mapper)) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.map callback must be a function.");
        }
    }

    var iterated = this;
    var iteratedNextMethod = iterated.next;

    var generator = (function*() {
        var counter = 0;
        for (;;) {
            var result = $iteratorGenericNext(iteratedNextMethod, iterated);
            if (result.done)
                return;

            var value = result.value;
            { let __iterator = iterated, __completion = 0; try { (
                yield mapper(value, counter++)
            ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
        }
    })();

    return $iteratorHelperCreate(generator, iterated);
}

// https://tc39.es/ecma262/#sec-iterator.prototype.filter
export function filter(predicate)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.filter requires that |this| be an Object.");

    if (!$isCallable(predicate)) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.filter callback must be a function.");
        }
    }

    var iterated = this;
    var iteratedNextMethod = iterated.next;

    var generator = (function*() {
        var counter = 0;
        for (;;) {
            var result = $iteratorGenericNext(iteratedNextMethod, iterated);
            if (result.done)
                return;

            var value = result.value;
            { let __iterator = iterated, __completion = 0; try { (
                predicate(value, counter++) && (yield value)
            ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
        }
    })();

    return $iteratorHelperCreate(generator, iterated);
}

// https://tc39.es/ecma262/#sec-iterator.prototype.take
export function take(limit)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.take requires that |this| be an Object.");

    var numLimit;
    { let __iterator = this, __completion = 0; try { numLimit = +(limit); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
    if (numLimit !== numLimit) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.take argument must not be NaN.");
        }
    }

    if ($isFinite(numLimit) && numLimit > 9007199254740991) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.take argument must be non-negative safe integer or +Infinity");
        }
    }

    var intLimit = $toIntegerOrInfinity(numLimit);
    if (intLimit < 0) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.take argument must be non-negative safe integer or +Infinity");
        }
    }

    var iterated = this;
    var iteratedNextMethod = iterated.next;

    var generator = (function*() {
        var remaining = intLimit;
        for (;;) {
            if (remaining === 0) {
                $iteratorGenericClose(iterated);
                return;
            }

            if (remaining !== Infinity)
                remaining--;

            var result = $iteratorGenericNext(iteratedNextMethod, iterated);
            if (result.done)
                return;

            var value = result.value;
            { let __iterator = iterated, __completion = 0; try { (
                yield value
            ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
        }
    })();

    return $iteratorHelperCreate(generator, iterated);
}

// https://tc39.es/ecma262/#sec-iterator.prototype.drop
export function drop(limit)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.drop requires that |this| be an Object.");

    var numLimit;
    { let __iterator = this, __completion = 0; try { (numLimit = +(limit)); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
    if (numLimit !== numLimit) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.drop argument must not be NaN.");
        }
    }

    if ($isFinite(numLimit) && numLimit > 9007199254740991) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.drop argument must be non-negative safe integer or +Infinity");
        }
    }

    var intLimit = $toIntegerOrInfinity(numLimit);
    if (intLimit < 0) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.drop argument must be non-negative safe integer or +Infinity");
        }
    }

    var iterated = this;
    var iteratedNextMethod = iterated.next;

    var generator = (function*() {
        var remaining = intLimit;
        for (;;) {
            var result = $iteratorGenericNext(iteratedNextMethod, iterated);
            if (result.done)
                return;

            if (remaining > 0) {
                if (remaining !== Infinity)
                    remaining--;
            } else {
                var value = result.value;
                { let __iterator = iterated, __completion = 0; try { (
                    yield value
                ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
            }
        }
    })();

    return $iteratorHelperCreate(generator, iterated);
}

// https://tc39.es/ecma262/#sec-iterator.prototype.flatmap
export function flatMap(mapper)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.flatMap requires that |this| be an Object.");

    if (!$isCallable(mapper)) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.flatMap callback must be a function.");
        }
    }

    var iterated = this;
    var iteratedNextMethod = iterated.next;
    var iteratedWrapper = {
        [Symbol.iterator]: function() { return this; },
        next: function() { return iteratedNextMethod.$call(iterated); },
        return: function() {
            var iteratedReturnMethod = iterated.return;
            if (!$isUndefinedOrNull(iteratedReturnMethod))
                return iteratedReturnMethod.$call(iterated);
            return { done: true };
        },
    };

    var generator = (function*() {
        var counter = 0;
        for (var item of iteratedWrapper) {
            var mapped = mapper(item, counter++);
            var innerIterator = $getIteratorFlattenable(mapped, /* rejectStrings: */ true);

            for (var innerItem of { [Symbol.iterator]: function() { return innerIterator; } })
                yield innerItem;
        }
    })();

    return $iteratorHelperCreate(generator, iterated);
}

// https://tc39.es/ecma262/#sec-iterator.prototype.some
export function some(predicate)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.some requires that |this| be an Object.");

    if (!$isCallable(predicate)) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.some callback must be a function.");
        }
    }

    var iterated = this;
    var count = 0;
    var wrapper = { [Symbol.iterator]: function () { return iterated; }};
    for (var item of wrapper) {
        if (predicate(item, count++))
            return true;
    }

    return false;
}

// https://tc39.es/ecma262/#sec-iterator.prototype.every
export function every(predicate)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.every requires that |this| be an Object.");

    if (!$isCallable(predicate)) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.every callback must be a function.");
        }
    }

    var iterated = this;
    var count = 0;
    var wrapper = { [Symbol.iterator]: function () { return iterated; }};
    for (var item of wrapper) {
        if (!predicate(item, count++))
            return false;
    }

    return true;
}

// https://tc39.es/ecma262/#sec-iterator.prototype.find
export function find(predicate)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.find requires that |this| be an Object.");

    if (!$isCallable(predicate)) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.find callback must be a function.");
        }
    }

    var iterated = this;
    var count = 0;
    var wrapper = { [Symbol.iterator]: function () { return iterated; }};
    for (var item of wrapper) {
        if (predicate(item, count++))
            return item;
    }

    return undefined;
}

// https://tc39.es/ecma262/#sec-iterator.prototype.reduce
export function reduce(reducer /*, initialValue */)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.reduce requires that |this| be an Object.");

    if (!$isCallable(reducer)) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.reduce reducer argument must be a function.");
        }
    }

    var iterated = this;
    var iteratedNextMethod = this.next;

    var accumulator;
    var counter = 0;
    if ($argumentCount() <= 1) {
        var result = $iteratorGenericNext(iteratedNextMethod, iterated);
        if (result.done)
            throw new TypeError("Iterator.prototype.reduce requires an initial value or an iterator that is not done.");
        accumulator = result.value;
        counter = 1;
    } else
        accumulator = $argument(1);

    for (;;) {
        var result = $iteratorGenericNext(iteratedNextMethod, iterated);
        if (result.done)
            break;

        var value = result.value;
        { let __iterator = iterated, __completion = 0; try { (
            accumulator = reducer(accumulator, value, counter++)
        ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
    }

    return accumulator;
}

// https://tc39.es/proposal-iterator-chunking/#sec-iterator.prototype.chunks
export function chunks(chunkSize)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.chunks requires that |this| be an Object.");

    if (typeof chunkSize !== "number" || chunkSize % 1 !== 0) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.chunks requires that first argument be an integral Number.");
        }
    }

    if (chunkSize < 1 || chunkSize > 4294967295) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.chunks requires that first argument be between 1 and 2**32 - 1.");
        }
    }

    var iterated = this;
    var iteratedNextMethod = this.next;

    var generator = (function*() {
        var buffer = [];

        for (;;) {
            var result = $iteratorGenericNext(iteratedNextMethod, iterated);
            if (result.done) {
                if (buffer.length)
                    yield buffer;
                return;
            }

            $arrayPush(buffer, result.value);

            if (buffer.length === chunkSize) {
                { let __iterator = iterated, __completion = 0; try { (
                    yield buffer
                ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }

                buffer = [];
            }
        }
    })();

    return $iteratorHelperCreate(generator, iterated);
}

// https://tc39.es/proposal-iterator-chunking/#sec-iterator.prototype.windows
export function windows(windowSize /*, undersized */)
{
    "use strict";

    if (!$isObject(this))
        throw new TypeError("Iterator.prototype.windows requires that |this| be an Object.");

    if (typeof windowSize !== "number" || windowSize % 1 !== 0) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.windows requires that first argument be an integral Number.");
        }
    }

    if (windowSize < 1 || windowSize > 4294967295) {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new RangeError("Iterator.prototype.windows requires that first argument be between 1 and 2**32 - 1.");
        }
    }

    var undersized = $argument(1);
    if (undersized === undefined)
        undersized = "only-full";
    else if (undersized !== "only-full" && undersized !== "allow-partial") {
        try {
            $iteratorGenericClose(this);
        } finally {
            throw new TypeError("Iterator.prototype.windows requires that second argument be \"only-full\" or \"allow-partial\".");
        }
    }

    var iterated = this;
    var iteratedNextMethod = this.next;

    var generator = (function*() {
        var buffer = [];

        for (;;) {
            var result = $iteratorGenericNext(iteratedNextMethod, iterated);
            if (result.done) {
                if (undersized === "allow-partial" && buffer.length && buffer.length < windowSize)
                    yield buffer;
                return;
            }

            if (buffer.length === windowSize) {
                for (var i = 0; i < buffer.length - 1; ++i)
                    buffer[i] = buffer[i + 1];
                buffer[buffer.length - 1] = result.value;
            } else
                $arrayPush(buffer, result.value);

            if (buffer.length === windowSize) {
                var copy = $newArrayWithSize(buffer.length);
                for (var i = 0; i < buffer.length; ++i)
                    copy[i] = buffer[i];

                { let __iterator = iterated, __completion = 0; try { (
                    yield copy
                ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
            }
        }
    })();

    return $iteratorHelperCreate(generator, iterated);
}

// https://tc39.es/proposal-explicit-resource-management/#sec-%iteratorprototype%-object
$overriddenName = "[Symbol.dispose]";
export function dispose()
{
    "use strict";

    var returnMethod = this.return;
    if (!$isUndefinedOrNull(returnMethod))
        returnMethod.$call(this);
}
