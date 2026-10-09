/*
 * Copyright (C) 2024 Sosuke Suzuki <aosukeke@gmail.com>.
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

// https://tc39.es/proposal-iterator-helpers/#sec-wrapforvaliditeratorprototype.next
export function next()
{
    "use strict";

    // 1. Let O be this value.
    // 2. Perform ? RequireInternalSlot(O, [[Iterated]]).
    // 3. Let iteratorRecord be O.[[Iterated]].
    if (!$isWrapForValidIterator(this))
        throw new TypeError("%WrapForValidIteratorPrototype%.next requires that |this| be a WrapForValidIteratorPrototype object");

    // 4. Return ? Call(iteratorRecord.[[NextMethod]], iteratorRecord.[[Iterator]]).
    return $getWrapForValidIteratorInternalField(this, $wrapForValidIteratorFieldIteratedNextMethod).$call($getWrapForValidIteratorInternalField(this, $wrapForValidIteratorFieldIteratedIterator));
}

// https://tc39.es/proposal-iterator-helpers/#sec-wrapforvaliditeratorprototype.return
$overriddenName = "return"; export function return_()
{
    "use strict";

    // 1. Let O be this value.
    // 2. Perform ? RequireInternalSlot(O, [[Iterated]]).
    // 3. Let iteratorRecord be O.[[Iterated]].
    if (!$isWrapForValidIterator(this))
        throw new TypeError("%WrapForValidIteratorPrototype%.next requires that |this| be a WrapForValidIteratorPrototype object");

    // 3. Let iterator be O.[[Iterated]].[[Iterator]].
    var iterator = $getWrapForValidIteratorInternalField(this, $wrapForValidIteratorFieldIteratedIterator);
    // 4. Assert: iterator is an Object.
    $assert($isObject(iterator));
    // 5. Let returnMethod be ? GetMethod(iterator, "return").
    var returnMethod = iterator.return;
    // 6. If returnMethod is undefined, then
    //   a. Return CreateIterResultObject(undefined, true).
    if ($isUndefinedOrNull(returnMethod))
        return { value: undefined, done: true };
    // 7. Return ? Call(returnMethod, iterator).
    return returnMethod.$call(iterator);
}
