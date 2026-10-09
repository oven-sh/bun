/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

$linkTimeConstant;
export function performIteration(iterable)
{
    "use strict";
    // This is performing a spread operation on the iterable passed in,
    // and returning the result in an array.
    // https://tc39.github.io/ecma262/#sec-runtime-semantics-arrayaccumulation

    var result = [];
    if ($isUndefinedOrNull(iterable))
        throw new TypeError('Spread syntax requires ...iterable not be null or undefined');
    
    var iteratorMethod = iterable[Symbol.iterator];
    if (!$isCallable(iteratorMethod))
        throw new TypeError('Spread syntax requires ...iterable[Symbol.iterator] to be a function');

    var iterator = iteratorMethod.$call(iterable);
    var next = iterator.next;
    var item;
    var index = 0;
    while (true) {
        item = next.$call(iterator);
        if (!$isObject(item))
            throw new TypeError("Iterator result interface is not an object");
        if (item.done)
            return result;
        $putByValDirect(result, index++, item.value);
    }
}

$linkTimeConstant;
export function wrappedIterator(iterator)
{
    var wrapper = $Object.$create(null);
    wrapper[Symbol.iterator] = function() { return iterator; }
    return wrapper;
}

$linkTimeConstant;
export function builtinSetIterable(set)
{
    "use strict";
    
    if (!$isSet(set))
        throw new TypeError("builtinSetIterable called with non-Set object.");

    // Using the private @@iterator only guarantees that the symbol itself has not been modified, but does not protect
    // against the iterator itself having been replaced. For Sets, `@values` has a copy of the function originally
    // placed at `Symbol.iterator`.
    var iteratorFunction = set.$values;
    
    return $wrappedIterator(iteratorFunction.$call(set));
}

$linkTimeConstant;
export function builtinMapIterable(map)
{
    "use strict";
    
    if (!$isMap(map))
        throw new TypeError("builtinMapIterable called with non-Map object.");

    // Using the private @@iterator only guarantees that the symbol itself has not been modified, but does not protect
    // against the iterator itself having been replaced. For Maps, `@entries` has a copy of the function originally
    // placed at `Symbol.iterator`.
    var iteratorFunction = map.$entries;

    return $wrappedIterator(iteratorFunction.$call(map));
}
