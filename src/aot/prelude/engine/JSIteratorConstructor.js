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

// https://tc39.es/proposal-iterator-helpers/#sec-getiteratorflattenable
$linkTimeConstant;
export function getIteratorFlattenable(obj, rejectStrings)
{
    "use strict";

    // 1. If obj is not an Object, then
    //   a. If stringHandling is reject-strings or obj is not a String, throw a TypeError exception.
    if (!$isObject(obj) && (rejectStrings || typeof obj !== "string"))
        throw new TypeError("GetIteratorFlattenable expects its first argument to be an object" + (rejectStrings ? "" : " or a string"));
    // 2. Let method be ? GetMethod(obj, @@iterator).
    var method = obj[Symbol.iterator];
    // 3. If method is undefined, then
    //   a. Let iterator be obj.
    var iterator;
    if ($isUndefinedOrNull(method)) {
        iterator = obj;
        // 4. Else,
        //   a. Let iterator be ? Call(method, obj).
    } else
        iterator = method.$call(obj);
    // 5. If iterator is not an Object, throw a TypeError exception.
    if (!$isObject(iterator))
        throw new TypeError("Iterator is not an object");
    // Step 6 isn't performed; raw iterator is returned instead of an Iterator Record.
    return iterator;
}

$linkTimeConstant;
export function getIteratorSync(obj)
{
    "use strict";

    // GetIterator(obj, SYNC):
    // 1. (The ASYNC kind is not applicable here.)
    // 2.a. Let method be ? GetMethod(obj, %Symbol.iterator%).
    var method = obj[Symbol.iterator];

    // 3. If method is undefined, throw a TypeError exception.
    if ($isUndefinedOrNull(method))
        throw new TypeError("Symbol.iterator is not defined");
    if (!$isCallable(method))
        throw new TypeError("Symbol.iterator is not callable");

    // 4. Return ? GetIteratorFromMethod(obj, method).
    var iterator = method.$call(obj);
    if (!$isObject(iterator))
        throw new TypeError("Iterator is not an object");
    return iterator;
}

// https://tc39.es/proposal-iterator-helpers/#sec-iterator.from
export function from(value)
{
    "use strict";

    // 1. Let iteratorRecord be ? GetIteratorFlattenable(O, iterate-strings).
    var iterator = $getIteratorFlattenable(value, /* rejectStrings: */ false);
    var iteratorNextMethod = iterator.next;
    // 2. Let hasInstance be ? OrdinaryHasInstance(%Iterator%, iteratorRecord.[[Iterator]]).
    // 3. If hasInstance is true, then
    //   a. Return iteratorRecord.[[Iterator]].
    if ($instanceOf(iterator, $Iterator.prototype))
        return iterator;

    // 4. Let wrapper be OrdinaryObjectCreate(%WrapForValidIteratorPrototype%, « [[Iterated]] »).
    // 5. Set wrapper.[[Iterated]] to iteratorRecord.
    // 6. Return wrapper.
    return $wrapForValidIteratorCreate(iterator, iteratorNextMethod);
}

// https://tc39.es/proposal-iterator-sequencing/#sec-iterator.concat
export function concat(/* ...items */)
{
    "use strict";

    var argumentCount = $argumentCount();

    var openMethods = [];
    var iterables = [];
    for (var i = 0; i < argumentCount; ++i) {
        var iterable = arguments[i];
        if (!$isObject(iterable))
            throw new TypeError("Iterator.concat expects all arguments to be objects");

        var openMethod = iterable[Symbol.iterator];
        if (!$isCallable(openMethod))
            throw new TypeError("Iterator.concat expects all arguments to be iterable");

        $arrayPush(openMethods, openMethod);
        $arrayPush(iterables, iterable);
    }

    var generator = (function*() {
        for (var i = 0; i < argumentCount; ++i) {
            var iterator = openMethods[i].$call(iterables[i]);
            if (!$isObject(iterator))
                throw new TypeError("Iterator.concat expects all arguments to be iterable");

            var nextMethod = iterator.next;

            for (;;) {
                var result = $iteratorGenericNext(nextMethod, iterator);
                if (result.done)
                    break;

                var value = result.value;
                { let __iterator = iterator, __completion = 0; try { (
                    yield value
                ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
            }
        }
    })();

    return $iteratorHelperCreate(generator, null);
}

$linkTimeConstant;
export function iteratorZip(iters, nextMethods, mode, padding, finishResults)
{
    "use strict";

    // 1. Let iterCount be the number of elements in iters.
    var iterCount = iters.length;

    // 2. Let openIters be a copy of iters.
    var openIters = [];
    for (var i = 0; i < iterCount; ++i)
        $arrayPush(openIters, iters[i]);

    // 4-6. The resulting Iterator Helper's single underlying iterator is a synthetic
    // object whose return() closes every still-open iterator. It stands in for the
    // spec's [[UnderlyingIterators]] List: closing the zip result (including via
    // return() before the first next(), when the closure body has never run) then
    // closes all of them. This is invoked with a return completion, so a failing
    // return() propagates.
    var underlyingIterators = $Object.$create(null);
    underlyingIterators.return = function () {
        $iteratorCloseAllNormal(openIters);
        return { done: true, value: undefined };
    };

    // 3. Let closure be a new Abstract Closure with no parameters that captures iters,
    //    iterCount, openIters, mode, padding, and finishResults, and performs the
    //    following steps when called:
    var generator = (function*() {
        // 3.a. If iterCount = 0, return ReturnCompletion(undefined).
        if (iterCount === 0)
            return;

        // 3.b. Repeat,
        for (;;) {
            // 3.b.i. Let results be a new empty List.
            var results = [];

            // 3.b.ii. Assert: openIters is not empty.

            // 3.b.iii. For each integer i such that 0 ≤ i < iterCount, in ascending order, do
            for (var i = 0; i < iterCount; ++i) {
                // 3.b.iii.1. Let iter be iters[i].
                var iter = iters[i];
                var result;

                // 3.b.iii.2. If iter is null, then
                if (iter === null) {
                    // 3.b.iii.2.a. Assert: mode is "longest".
                    // 3.b.iii.2.b. Let result be padding[i].
                    result = padding[i];
                } else {
                    // 3.b.iii.3.a. Let result be Completion(IteratorStepValue(iter)).
                    var stepDone;
                    var stepValue;
                    try {
                        var stepResult = $iteratorGenericNext(nextMethods[i], iter);
                        stepDone = stepResult.done;
                        if (!stepDone)
                            stepValue = stepResult.value;
                    } catch (e) {
                        // 3.b.iii.3.b. If result is an abrupt completion, then
                        // 3.b.iii.3.b.i. Remove iter from openIters.
                        $removeFirstFromList(openIters, iter);
                        // 3.b.iii.3.b.ii. Return ? IteratorCloseAll(openIters, result).
                        $closeAllIterators(openIters);
                        throw e;
                    }

                    // 3.b.iii.3.c. Set result to ! result.
                    // 3.b.iii.3.d. If result is DONE, then
                    if (stepDone) {
                        // 3.b.iii.3.d.i. Remove iter from openIters.
                        $removeFirstFromList(openIters, iter);

                        // 3.b.iii.3.d.ii. If mode is "shortest", then
                        if (mode === "shortest") {
                            // Return ? IteratorCloseAll(openIters, ReturnCompletion(undefined)).
                            $iteratorCloseAllNormal(openIters);
                            return;
                        }

                        // 3.b.iii.3.d.iii. Else if mode is "strict", then
                        if (mode === "strict") {
                            // 3.b.iii.3.d.iii.i. If i ≠ 0, then
                            if (i !== 0) {
                                // Return ? IteratorCloseAll(openIters, ThrowCompletion(a newly created TypeError object)).
                                $closeAllIterators(openIters);
                                throw new TypeError("Iterator.zip strict mode requires all iterables to have the same number of elements");
                            }

                            // 3.b.iii.3.d.iii.ii. For each integer k such that 1 ≤ k < iterCount, in ascending order, do
                            for (var k = 1; k < iterCount; ++k) {
                                // 3.b.iii.3.d.iii.ii.i. Assert: iters[k] is not null.
                                var otherIter = iters[k];
                                var otherDone;
                                try {
                                    // 3.b.iii.3.d.iii.ii.ii. Let open be Completion(IteratorStep(iters[k])). (Value is not read.)
                                    var otherResult = $iteratorGenericNext(nextMethods[k], otherIter);
                                    otherDone = otherResult.done;
                                } catch (e) {
                                    // 3.b.iii.3.d.iii.ii.iii. If open is an abrupt completion, then
                                    // 3.b.iii.3.d.iii.ii.iii.i. Remove iters[k] from openIters.
                                    $removeFirstFromList(openIters, otherIter);
                                    // 3.b.iii.3.d.iii.ii.iii.ii. Return ? IteratorCloseAll(openIters, open).
                                    $closeAllIterators(openIters);
                                    throw e;
                                }

                                // 3.b.iii.3.d.iii.ii.v. If open is DONE, then
                                if (otherDone) {
                                    // 3.b.iii.3.d.iii.ii.v.i. Remove iters[k] from openIters.
                                    $removeFirstFromList(openIters, otherIter);
                                } else {
                                    // 3.b.iii.3.d.iii.ii.vi.i. Return ? IteratorCloseAll(openIters, ThrowCompletion(a newly created TypeError object)).
                                    $closeAllIterators(openIters);
                                    throw new TypeError("Iterator.zip strict mode requires all iterables to have the same number of elements");
                                }
                            }

                            // 3.b.iii.3.d.iii.iii. Return ReturnCompletion(undefined).
                            return;
                        }

                        // 3.b.iii.3.d.iv. Else (mode is "longest"),
                        // 3.b.iii.3.d.iv.ii. If openIters is empty, return ReturnCompletion(undefined).
                        if (openIters.length === 0)
                            return;
                        // 3.b.iii.3.d.iv.iii. Set iters[i] to null.
                        iters[i] = null;
                        // 3.b.iii.3.d.iv.iv. Set result to padding[i].
                        result = padding[i];
                    } else {
                        result = stepValue;
                    }
                }

                // 3.b.iii.4. Append result to results.
                $arrayPush(results, result);
            }

            // 3.b.iv. Set results to finishResults(results).
            results = finishResults(results);

            // 3.b.v. Let completion be Completion(Yield(results)).
            // 3.b.vi. If completion is an abrupt completion, then
            // 3.b.vi.1. Return ? IteratorCloseAll(openIters, completion).
            { let __iterator = underlyingIterators, __completion = 0; try { (
                yield results
            ); __completion = 1; } catch (__error) { __completion = 2; try { $iteratorGenericClose(__iterator); } catch { } throw __error; } finally { if (!__completion) $iteratorGenericClose(__iterator); } }
        }
    })();

    // 4. Let gen be CreateIteratorFromClosure(closure, "Iterator Helper", %IteratorHelperPrototype%, « [[UnderlyingIterators]] »).
    // 5. Set gen.[[UnderlyingIterators]] to openIters.
    // 6. Return gen.
    return $iteratorHelperCreate(generator, underlyingIterators);
}

$linkTimeConstant;
export function getOptionsObject(options)
{
    // 1. If options is undefined, then
    if (options === undefined) {
        // 1.a. Return OrdinaryObjectCreate(null).
        return $Object.$create(null);
    }

    // 2. If options is an Object, then
    if ($isObject(options)) {
        // 2.a. Return options.
        return options;
    }

    // 3. Throw a TypeError exception.
    throw new TypeError("Expected object or null for options argument");
}

$linkTimeConstant;
export function closeAllIterators(openIters)
{
    "use strict";

    for (var i = openIters.length - 1; i >= 0; --i) {
        try {
            $iteratorGenericClose(openIters[i]);
        } catch (e) { }
    }
}

$linkTimeConstant;
export function iteratorCloseAllNormal(openIters)
{
    "use strict";

    var error;
    var hasError = false;
    for (var i = openIters.length - 1; i >= 0; --i) {
        try {
            $iteratorGenericClose(openIters[i]);
        } catch (e) {
            if (!hasError) {
                hasError = true;
                error = e;
            }
        }
    }
    if (hasError)
        throw error;
}

// Removes the first occurrence of |value| from |list| (an Array used as a spec List),
// preserving the order of the remaining elements.
$linkTimeConstant;
export function removeFirstFromList(list, value)
{
    "use strict";

    var length = list.length;
    var shifting = false;
    for (var i = 0; i < length; ++i) {
        if (shifting)
            $putByValDirect(list, i - 1, list[i]);
        else if (list[i] === value)
            shifting = true;
    }
    if (shifting)
        list.length = length - 1;
}

export function zip(iterables /*, options */)
{
    "use strict";

    var options = $argument(1);

    // 1. If iterables is not an Object, throw a TypeError exception.
    if (!$isObject(iterables))
        throw new TypeError("Iterator.zip expects its first argument to be an object");

    // 2. Set options to ? GetOptionsObject(options).
    options = $getOptionsObject(options);

    // 3. Let mode be ? Get(options, "mode").
    var mode = options.mode;

    // 4. If mode is undefined, set mode to "shortest".
    if (mode === undefined)
        mode = "shortest";

    // 5. If mode is not one of "shortest", "longest", or "strict", throw a TypeError exception.
    if (mode !== "shortest" && mode !== "longest" && mode !== "strict")
        throw new TypeError("Expected \"shortest\", \"longest\" or \"strict\" for options.mode");

    // 6. Let paddingOption be undefined.
    var paddingOption = undefined;

    // 7. If mode is "longest", then
    if (mode === "longest") {
        // 7.a. Set paddingOption to ? Get(options, "padding").
        paddingOption = options.padding;
        // 7.b. If paddingOption is not undefined and paddingOption is not an Object, throw a TypeError exception.
        if (paddingOption !== undefined && !$isObject(paddingOption))
            throw new TypeError("Expected options.padding to be an object");
    }

    // 8. Let iters be a new empty List.
    var iters = [];
    var nextMethods = [];

    // 9. Let padding be a new empty List.
    var padding = [];

    // 10. Let inputIter be ? GetIterator(iterables, SYNC).
    var inputIter = $getIteratorSync(iterables);
    var inputIterNextMethod = inputIter.next;

    // 11. Let next be NOT-STARTED.
    // 12. Repeat, while next is not DONE,
    for (;;) {
        var done;
        var value;
        try {
            // 12.a. Set next to Completion(IteratorStepValue(inputIter)).
            var result = $iteratorGenericNext(inputIterNextMethod, inputIter);
            done = result.done;
            if (!done)
                value = result.value;
        } catch (e) {
            // 12.b. IfAbruptCloseIterators(next, iters).
            $closeAllIterators(iters);
            throw e;
        }

        // 12.c. If next is not DONE, then
        if (done)
            break;

        var iter;
        var iterNextMethod;
        try {
            // 12.c.i. Let iter be Completion(GetIteratorFlattenable(next, REJECT-PRIMITIVES)).
            iter = $getIteratorFlattenable(value, /* rejectStrings: */ true);
            iterNextMethod = iter.next;
        } catch (e) {
            // 12.c.ii. IfAbruptCloseIterators(iter, the list-concatenation of « inputIter » and iters).
            $closeAllIterators(iters);
            try {
                $iteratorGenericClose(inputIter);
            } catch (e2) { }
            throw e;
        }

        // 12.c.iii. Append iter to iters.
        $arrayPush(iters, iter);
        $arrayPush(nextMethods, iterNextMethod);
    }

    // 13. Let iterCount be the number of elements in iters.
    var iterCount = iters.length;

    // 14. If mode is "longest", then
    if (mode === "longest") {
        // 14.a. If paddingOption is undefined, then
        if (paddingOption === undefined) {
            // 14.a.i. Perform the following steps iterCount times:
            for (var i = 0; i < iterCount; ++i) {
                // 14.a.i.1. Append undefined to padding.
                $arrayPush(padding, undefined);
            }
        } else {
            // 14.b.i. Let paddingIter be Completion(GetIterator(paddingOption, SYNC)).
            var paddingIter;
            var paddingIterNextMethod;
            try {
                paddingIter = $getIteratorSync(paddingOption);
                paddingIterNextMethod = paddingIter.next;
            } catch (e) {
                // 14.b.ii. IfAbruptCloseIterators(paddingIter, iters).
                $closeAllIterators(iters);
                throw e;
            }

            // 14.b.iii. Let usingIterator be true.
            var usingIterator = true;

            // 14.b.iv. Perform the following steps iterCount times:
            for (var i = 0; i < iterCount; ++i) {
                // 14.b.iv.1. If usingIterator is true, then
                if (usingIterator) {
                    var paddingDone;
                    var paddingValue;
                    try {
                        // 14.b.iv.1.a. Set next to Completion(IteratorStepValue(paddingIter)).
                        var paddingResult = $iteratorGenericNext(paddingIterNextMethod, paddingIter);
                        paddingDone = paddingResult.done;
                        if (!paddingDone)
                            paddingValue = paddingResult.value;
                    } catch (e) {
                        // 14.b.iv.1.b. IfAbruptCloseIterators(next, iters).
                        $closeAllIterators(iters);
                        throw e;
                    }

                    // 14.b.iv.1.c. If next is DONE, then
                    if (paddingDone) {
                        // 14.b.iv.1.c.i. Set usingIterator to false.
                        usingIterator = false;
                    } else {
                        // 14.b.iv.1.d.i. Append next to padding.
                        $arrayPush(padding, paddingValue);
                    }
                }

                // 14.b.iv.2. If usingIterator is false, append undefined to padding.
                if (!usingIterator)
                    $arrayPush(padding, undefined);
            }

            // 14.b.v. If usingIterator is true, then
            if (usingIterator) {
                try {
                    // 14.b.v.1. Let completion be Completion(IteratorClose(paddingIter, NormalCompletion(UNUSED))).
                    $iteratorGenericClose(paddingIter);
                } catch (e) {
                    // 14.b.v.2. IfAbruptCloseIterators(completion, iters).
                    $closeAllIterators(iters);
                    throw e;
                }
            }
        }
    }

    // 15. Let finishResults be a new Abstract Closure with parameters (results) that captures nothing and performs the following steps when called:
    var finishResults = (results) => {
        // 15.a. Return CreateArrayFromList(results).
        return results;
    };

    // 16. Return IteratorZip(iters, mode, padding, finishResults).
    return $iteratorZip(iters, nextMethods, mode, padding, finishResults);
}

export function zipKeyed(iterables /*, options */)
{
    "use strict";

    var options = $argument(1);

    // 1. If iterables is not an Object, throw a TypeError exception.
    if (!$isObject(iterables))
        throw new TypeError("Iterator.zipKeyed expects its first argument to be an object");

    // 2. Set options to ? GetOptionsObject(options).
    options = $getOptionsObject(options);

    // 3. Let mode be ? Get(options, "mode").
    var mode = options.mode;

    // 4. If mode is undefined, set mode to "shortest".
    if (mode === undefined)
        mode = "shortest";

    // 5. If mode is not one of "shortest", "longest", or "strict", throw a TypeError exception.
    if (mode !== "shortest" && mode !== "longest" && mode !== "strict")
        throw new TypeError("Expected \"shortest\", \"longest\" or \"strict\" for options.mode");

    // 6. Let paddingOption be undefined.
    var paddingOption = undefined;

    // 7. If mode is "longest", then
    if (mode === "longest") {
        // 7.a. Set paddingOption to ? Get(options, "padding").
        paddingOption = options.padding;
        // 7.b. If paddingOption is not undefined and paddingOption is not an Object, throw a TypeError exception.
        if (paddingOption !== undefined && !$isObject(paddingOption))
            throw new TypeError("Expected options.padding to be an object");
    }

    // 8. Let iters be a new empty List.
    var iters = [];
    var nextMethods = [];

    // 9. Let padding be a new empty List.
    var padding = [];

    // 10. Let allKeys be ? iterables.[[OwnPropertyKeys]]().
    var allKeys = $ownKeys(iterables);

    // 11. Let keys be a new empty List.
    var keys = [];

    // 12. For each element key of allKeys, do
    var allKeysCount = allKeys.length;
    for (var k = 0; k < allKeysCount; ++k) {
        var key = allKeys[k];

        // 12.a. Let desc be Completion(iterables.[[GetOwnProperty]](key)).
        var desc;
        try {
            desc = $Object.$getOwnPropertyDescriptor(iterables, key);
        } catch (e) {
            // 12.b. IfAbruptCloseIterators(desc, iters).
            $closeAllIterators(iters);
            throw e;
        }

        // 12.c. If desc is not undefined and desc.[[Enumerable]] is true, then
        if (desc !== undefined && desc.enumerable) {
            // 12.c.i. Let value be Completion(Get(iterables, key)).
            var value;
            try {
                value = iterables[key];
            } catch (e) {
                // 12.c.ii. IfAbruptCloseIterators(value, iters).
                $closeAllIterators(iters);
                throw e;
            }

            // 12.c.iii. If value is not undefined, then
            if (value !== undefined) {
                // 12.c.iii.1. Append key to keys.
                $arrayPush(keys, key);

                // 12.c.iii.2. Let iter be Completion(GetIteratorFlattenable(value, REJECT-PRIMITIVES)).
                var iter;
                var iterNextMethod;
                try {
                    iter = $getIteratorFlattenable(value, /* rejectStrings: */ true);
                    iterNextMethod = iter.next;
                } catch (e) {
                    // 12.c.iii.3. IfAbruptCloseIterators(iter, iters).
                    $closeAllIterators(iters);
                    throw e;
                }

                // 12.c.iii.4. Append iter to iters.
                $arrayPush(iters, iter);
                $arrayPush(nextMethods, iterNextMethod);
            }
        }
    }

    // 13. Let iterCount be the number of elements in iters.
    var iterCount = iters.length;

    // 14. If mode is "longest", then
    if (mode === "longest") {
        // 14.a. If paddingOption is undefined, then
        if (paddingOption === undefined) {
            // 14.a.i. Perform the following steps iterCount times:
            for (var i = 0; i < iterCount; ++i) {
                // 14.a.i.1. Append undefined to padding.
                $arrayPush(padding, undefined);
            }
        } else {
            // 14.b.i. For each element key of keys, do
            for (var i = 0; i < iterCount; ++i) {
                // 14.b.i.1. Let value be Completion(Get(paddingOption, key)).
                var paddingValue;
                try {
                    paddingValue = paddingOption[keys[i]];
                } catch (e) {
                    // 14.b.i.2. IfAbruptCloseIterators(value, iters).
                    $closeAllIterators(iters);
                    throw e;
                }
                // 14.b.i.3. Append value to padding.
                $arrayPush(padding, paddingValue);
            }
        }
    }

    // 15. Let finishResults be a new Abstract Closure with parameters (results) that captures keys and iterCount and performs the following steps when called:
    var finishResults = (results) => {
        // 15.a. Let obj be OrdinaryObjectCreate(null).
        var obj = $Object.$create(null);
        // 15.b. For each integer i such that 0 ≤ i < iterCount, in ascending order, do
        for (var i = 0; i < iterCount; ++i) {
            // 15.b.i. Perform ! CreateDataPropertyOrThrow(obj, keys[i], results[i]).
            $putByValDirect(obj, keys[i], results[i]);
        }
        // 15.c. Return obj.
        return obj;
    };

    // 16. Return IteratorZip(iters, mode, padding, finishResults).
    return $iteratorZip(iters, nextMethods, mode, padding, finishResults);
}
