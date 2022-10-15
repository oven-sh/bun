/*
 * Copyright (C) 2016-2018 Apple Inc. All rights reserved.
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


@linkTimeConstant
function advanceStringIndex(string, index, unicode)
{
    // This function implements AdvanceStringIndex described in ES6 21.2.5.2.3.
    "use strict";

    if (!unicode)
        return index + 1;

    if (index + 1 >= string.length)
        return index + 1;

    var first = string.@charCodeAt(index);
    if (first < 0xD800 || first > 0xDBFF)
        return index + 1;

    var second = string.@charCodeAt(index + 1);
    if (second < 0xDC00 || second > 0xDFFF)
        return index + 1;

    return index + 2;
}


@linkTimeConstant
function matchSlow(regexp, str)
{
    "use strict";

    if (!regexp.global)
        return regexp.exec(str);
    
    var unicode = regexp.unicode;
    regexp.lastIndex = 0;
    var resultList = [];

    // FIXME: It would be great to implement a solution similar to what we do in
    // RegExpObject::matchGlobal(). It's not clear if this is possible, since this loop has
    // effects. https://bugs.webkit.org/show_bug.cgi?id=158145
    var maximumReasonableMatchSize = 100000000;

    while (true) {
        var result = regexp.exec(str);
        
        if (result === null) {
            if (resultList.length === 0)
                return null;
            return resultList;
        }

        if (resultList.length > maximumReasonableMatchSize)
            @throwOutOfMemoryError();

        var resultString = @toString(result[0]);

        if (!resultString.length)
            regexp.lastIndex = @advanceStringIndex(str, regexp.lastIndex, unicode);

        @arrayPush(resultList, resultString);
    }
}

@overriddenName="[Symbol.match]"
function match(strArg)
{
    "use strict";

    if (!@isObject(this))
        @throwTypeError("RegExp.prototype.@@match requires that |this| be an Object");

    var str = @toString(strArg);

    return @matchSlow(this, str);
}

@overriddenName="[Symbol.matchAll]"
function matchAll(strArg)
{
    "use strict";

    var regExp = this;
    if (!@isObject(regExp)) {
        @throwTypeError("RegExp.prototype.@@matchAll requires |this| to be an Object");
    }

    var string = @toString(strArg);

    var Matcher = @speciesConstructor(regExp, @Bun.OnigurumaRegExp);

    var flags = @toString(regExp.flags);
    var matcher = new Matcher(regExp.source, flags);
    matcher.lastIndex = @toLength(regExp.lastIndex);

    var global = @stringIncludesInternal.@call(flags, "g");
    var fullUnicode = @stringIncludesInternal.@call(flags, "u");

    var iterator = globalThis.Symbol.iterator;

    var RegExpStringIterator = class RegExpStringIterator {
        constructor(regExp, string, global, fullUnicode)
        {
    
            @putByIdDirectPrivate(this, "regExpStringIteratorRegExp", regExp);
            @putByIdDirectPrivate(this, "regExpStringIteratorString", string);
            @putByIdDirectPrivate(this, "regExpStringIteratorGlobal", global);
            @putByIdDirectPrivate(this, "regExpStringIteratorUnicode", fullUnicode);
            @putByIdDirectPrivate(this, "regExpStringIteratorDone", false);
        }

        next() {
            "use strict";
            if (!@isObject(this)) {
                @throwTypeError("%RegExpStringIteratorPrototype%.next requires |this| to be an Object");
            }
        
            var done = @getByIdDirectPrivate(this, "regExpStringIteratorDone");
            if (done === @undefined) {
                @throwTypeError("%RegExpStringIteratorPrototype%.next requires |this| to be an RegExp String Iterator instance");
            }
        
            if (done) {
                return { value: @undefined, done: true };
            }
        
            var regExp = @getByIdDirectPrivate(this, "regExpStringIteratorRegExp");
            var string = @getByIdDirectPrivate(this, "regExpStringIteratorString");
            var global = @getByIdDirectPrivate(this, "regExpStringIteratorGlobal");
            var fullUnicode = @getByIdDirectPrivate(this, "regExpStringIteratorUnicode");
            var match = regExp.exec(string);
            if (match === null) {
                @putByIdDirectPrivate(this, "regExpStringIteratorDone", true);
                return { value: @undefined, done: true };
            }
        
            if (global) {
                var matchStr = @toString(match[0]);
                if (matchStr === "") {
                    var thisIndex = @toLength(regExp.lastIndex);
                    regExp.lastIndex = @advanceStringIndex(string, thisIndex, fullUnicode);
                }
            } else
                @putByIdDirectPrivate(this, "regExpStringIteratorDone", true);
        
            return { value: match, done: false };
        }

        [iterator]() {
            return this;
        }

    };

    return new RegExpStringIterator(matcher, string, global, fullUnicode);
}

@linkTimeConstant
function getSubstitution(matched, str, position, captures, namedCaptures, replacement)
{
    "use strict";

    var matchLength = matched.length;
    var stringLength = str.length;
    var tailPos = position + matchLength;
    var m = captures.length;
    var replacementLength = replacement.length;
    var result = "";
    var lastStart = 0;

    for (var start = 0; start = @stringIndexOfInternal.@call(replacement, "$", lastStart), start !== -1; lastStart = start) {
        if (start - lastStart > 0)
            result = result + @stringSubstring.@call(replacement, lastStart, start);
        start++;
        if (start >= replacementLength)
            result = result + "$";
        else {
            var ch = replacement[start];
            switch (ch)
            {
            case "$":
                result = result + "$";
                start++;
                break;
            case "&":
                result = result + matched;
                start++;
                break;
            case "`":
                if (position > 0)
                    result = result + @stringSubstring.@call(str, 0, position);
                start++;
                break;
            case "'":
                if (tailPos < stringLength)
                    result = result + @stringSubstring.@call(str, tailPos);
                start++;
                break;
            case "<":
                if (namedCaptures !== @undefined) {
                    var groupNameStartIndex = start + 1;
                    var groupNameEndIndex = @stringIndexOfInternal.@call(replacement, ">", groupNameStartIndex);
                    if (groupNameEndIndex !== -1) {
                        var groupName = @stringSubstring.@call(replacement, groupNameStartIndex, groupNameEndIndex);
                        var capture = namedCaptures[groupName];
                        if (capture !== @undefined)
                            result = result + @toString(capture);

                        start = groupNameEndIndex + 1;
                        break;
                    }
                }

                result = result + "$<";
                start++;
                break;
            default:
                var chCode = ch.@charCodeAt(0);
                if (chCode >= 0x30 && chCode <= 0x39) {
                    var originalStart = start - 1;
                    start++;

                    var n = chCode - 0x30;
                    if (n > m) {
                        result = result + @stringSubstring.@call(replacement, originalStart, start);
                        break;
                    }

                    if (start < replacementLength) {
                        var nextChCode = replacement.@charCodeAt(start);
                        if (nextChCode >= 0x30 && nextChCode <= 0x39) {
                            var nn = 10 * n + nextChCode - 0x30;
                            if (nn <= m) {
                                n = nn;
                                start++;
                            }
                        }
                    }

                    if (n == 0) {
                        result = result + @stringSubstring.@call(replacement, originalStart, start);
                        break;
                    }

                    var capture = captures[n - 1];
                    if (capture !== @undefined)
                        result = result + capture;
                } else
                    result = result + "$";
                break;
            }
        }
    }

    return result + @stringSubstring.@call(replacement, lastStart);
}

@overriddenName="[Symbol.replace]"
function replace(strArg, replace)
{
    "use strict";

    if (!@isObject(this))
        @throwTypeError("RegExp.prototype.@@replace requires that |this| be an Object");

    var regexp = this;

    var str = @toString(strArg);
    var stringLength = str.length;
    var functionalReplace = @isCallable(replace);

    if (!functionalReplace)
        replace = @toString(replace);

    var global = regexp.global;
    var unicode = false;

    if (global) {
        unicode = regexp.unicode;
        regexp.lastIndex = 0;
    }

    var resultList = [];
    var result;
    var done = false;
    while (!done) {
        result = regexp.exec(str);

        if (result === null)
            done = true;
        else {
            @arrayPush(resultList, result);
            if (!global)
                done = true;
            else {
                var matchStr = @toString(result[0]);

                if (!matchStr.length) {
                    var thisIndex = @toLength(regexp.lastIndex);
                    regexp.lastIndex = @advanceStringIndex(str, thisIndex, unicode);
                }
            }
        }
    }

    var accumulatedResult = "";
    var nextSourcePosition = 0;

    for (var i = 0, resultListLength = resultList.length; i < resultListLength; ++i) {
        var result = resultList[i];
        var nCaptures = result.length - 1;
        if (nCaptures < 0)
            nCaptures = 0;
        var matched = @toString(result[0]);
        var matchLength = matched.length;
        var position = @toIntegerOrInfinity(result.index);
        position = (position > stringLength) ? stringLength : position;
        position = (position < 0) ? 0 : position;

        var captures = [];
        for (var n = 1; n <= nCaptures; n++) {
            var capN = result[n];
            if (capN !== @undefined)
                capN = @toString(capN);
            @arrayPush(captures, capN);
        }

        var replacement;
        var namedCaptures = result.groups;

        if (functionalReplace) {
            var replacerArgs = [ matched ];
            for (var j = 0; j < captures.length; j++)
                @arrayPush(replacerArgs, captures[j]);

            @arrayPush(replacerArgs, position);
            @arrayPush(replacerArgs, str);

            if (namedCaptures !== @undefined)
                @arrayPush(replacerArgs, namedCaptures);

            var replValue = replace.@apply(@undefined, replacerArgs);
            replacement = @toString(replValue);
        } else {
            if (namedCaptures !== @undefined)
                namedCaptures = @toObject(namedCaptures, "RegExp.prototype[Symbol.replace] requires 'groups' property of a match not be null");

            replacement = @getSubstitution(matched, str, position, captures, namedCaptures, replace);
        }

        if (position >= nextSourcePosition) {
            accumulatedResult = accumulatedResult + @stringSubstring.@call(str, nextSourcePosition, position) + replacement;
            nextSourcePosition = position + matchLength;
        }
    }

    if (nextSourcePosition >= stringLength)
        return  accumulatedResult;

    return accumulatedResult + @stringSubstring.@call(str, nextSourcePosition);
}

// 21.2.5.9 RegExp.prototype[@@search] (string)
@overriddenName="[Symbol.search]"
function search(strArg)
{
    "use strict";

    var regexp = this;

    // 1. Let rx be the this value.
    // 2. If Type(rx) is not Object, throw a TypeError exception.
    if (!@isObject(this))
        @throwTypeError("RegExp.prototype.@@search requires that |this| be an Object");

    // 3. Let S be ? ToString(string).
    var str = @toString(strArg)

    // 4. Let previousLastIndex be ? Get(rx, "lastIndex").
    var previousLastIndex = regexp.lastIndex;

    // 5. If SameValue(previousLastIndex, 0) is false, then
    // 5.a. Perform ? Set(rx, "lastIndex", 0, true).
    if (!@sameValue(previousLastIndex, 0))
        regexp.lastIndex = 0;

    // 6. Let result be ? RegExpExec(rx, S).
    var result = regexp.exec(str);

    // 7. Let currentLastIndex be ? Get(rx, "lastIndex").
    // 8. If SameValue(currentLastIndex, previousLastIndex) is false, then
    // 8.a. Perform ? Set(rx, "lastIndex", previousLastIndex, true).
    if (!@sameValue(regexp.lastIndex, previousLastIndex))
        regexp.lastIndex = previousLastIndex;

    // 9. If result is null, return -1.
    if (result === null)
        return -1;

    // 10. Return ? Get(result, "index").
    return result.index;
}

// ES 21.2.5.11 RegExp.prototype[@@split](string, limit)
@overriddenName="[Symbol.split]"
function split(string, limit)
{
    "use strict";

    // 1. Let rx be the this value.
    // 2. If Type(rx) is not Object, throw a TypeError exception.
    if (!@isObject(this))
        @throwTypeError("RegExp.prototype.@@split requires that |this| be an Object");
    var regexp = this;

    // 3. Let S be ? ToString(string).
    var str = @toString(string);

    // 4. Let C be ? SpeciesConstructor(rx, %RegExp%).
    var speciesConstructor = @speciesConstructor(regexp, @RegExp);

    // 5. Let flags be ? ToString(? Get(rx, "flags")).
    var flags = @toString(regexp.flags);

    // 6. If flags contains "u", var unicodeMatching be true.
    // 7. Else, let unicodeMatching be false.
    var unicodeMatching = @stringIncludesInternal.@call(flags, "u");
    // 8. If flags contains "y", var newFlags be flags.
    // 9. Else, let newFlags be the string that is the concatenation of flags and "y".
    var newFlags = @stringIncludesInternal.@call(flags, "y") ? flags : flags + "y";

    // 10. Let splitter be ? Construct(C, « rx, newFlags »).
    var splitter = new speciesConstructor(regexp.source, newFlags);

    // We need to check again for RegExp subclasses that will fail the speciesConstructor test
    // but can still use the fast path after we invoke the constructor above.

    // 11. Let A be ArrayCreate(0).
    // 12. Let lengthA be 0.
    var result = [];

    // 13. If limit is undefined, let lim be 2^32-1; else var lim be ? ToUint32(limit).
    limit = (limit === @undefined) ? 0xffffffff : limit >>> 0;

    // 16. If lim = 0, return A.
    if (!limit)
        return result;

    // 14. [Defered from above] Let size be the number of elements in S.
    var size = str.length;

    // 17. If size = 0, then
    if (!size) {
        // a. Let z be ? RegExpExec(splitter, S).
        var z = splitter.exec(str);
        // b. If z is not null, return A.
        if (z !== null)
            return result;
        // c. Perform ! CreateDataProperty(A, "0", S).
        @putByValDirect(result, 0, str);
        // d. Return A.
        return result;
    }

    // 15. [Defered from above] Let p be 0.
    var position = 0;
    // 18. Let q be p.
    var matchPosition = 0;

    // 19. Repeat, while q < size
    while (matchPosition < size) {
        // a. Perform ? Set(splitter, "lastIndex", q, true).
        splitter.lastIndex = matchPosition;
        // b. Let z be ? RegExpExec(splitter, S).
        var matches = splitter.exec(str);
        // c. If z is null, let q be AdvanceStringIndex(S, q, unicodeMatching).
        if (matches === null)
            matchPosition = @advanceStringIndex(str, matchPosition, unicodeMatching);
        // d. Else z is not null,
        else {
            // i. Let e be ? ToLength(? Get(splitter, "lastIndex")).
            var endPosition = @toLength(splitter.lastIndex);
            // ii. Let e be min(e, size).
            endPosition = (endPosition <= size) ? endPosition : size;
            // iii. If e = p, let q be AdvanceStringIndex(S, q, unicodeMatching).
            if (endPosition === position)
                matchPosition = @advanceStringIndex(str, matchPosition, unicodeMatching);
            // iv. Else e != p,
            else {
                // 1. Let T be a String value equal to the substring of S consisting of the elements at indices p (inclusive) through q (exclusive).
                var subStr = @stringSubstring.@call(str, position, matchPosition);
                // 2. Perform ! CreateDataProperty(A, ! ToString(lengthA), T).
                // 3. Let lengthA be lengthA + 1.
                @arrayPush(result, subStr);
                // 4. If lengthA = lim, return A.
                if (result.length == limit)
                    return result;

                // 5. Let p be e.
                position = endPosition;
                // 6. Let numberOfCaptures be ? ToLength(? Get(z, "length")).
                // 7. Let numberOfCaptures be max(numberOfCaptures-1, 0).
                var numberOfCaptures = matches.length > 1 ? matches.length - 1 : 0;

                // 8. Let i be 1.
                var i = 1;
                // 9. Repeat, while i <= numberOfCaptures,
                while (i <= numberOfCaptures) {
                    // a. Let nextCapture be ? Get(z, ! ToString(i)).
                    var nextCapture = matches[i];
                    // b. Perform ! CreateDataProperty(A, ! ToString(lengthA), nextCapture).
                    // d. Let lengthA be lengthA + 1.
                    @arrayPush(result, nextCapture);
                    // e. If lengthA = lim, return A.
                    if (result.length == limit)
                        return result;
                    // c. Let i be i + 1.
                    i++;
                }
                // 10. Let q be p.
                matchPosition = position;
            }
        }
    }
    // 20. Let T be a String value equal to the substring of S consisting of the elements at indices p (inclusive) through size (exclusive).
    var remainingStr = @stringSubstring.@call(str, position, size);
    // 21. Perform ! CreateDataProperty(A, ! ToString(lengthA), T).
    @arrayPush(result, remainingStr);
    // 22. Return A.
    return result;
}

// ES 21.2.5.13 RegExp.prototype.test(string)
function test(strArg)
{
    "use strict";

    var regexp = this;

    if (regexp.test == @Bun.OnigurumaRegExp.prototype.test) {
        return regexp.test(strArg);
    }

    // 1. Let R be the this value.
    // 2. If Type(R) is not Object, throw a TypeError exception.
    if (!@isObject(regexp))
        @throwTypeError("RegExp.prototype.test requires that |this| be an Object");

    // 3. Let string be ? ToString(S).
    var str = @toString(strArg);

    // 4. Let match be ? RegExpExec(R, string).
    var match = regexp.exec(str);

    // 5. If match is not null, return true; else return false.
    if (match !== null)
        return true;
    return false;
}
