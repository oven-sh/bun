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

    const newHighWaterMark = @toNumber(highWaterMark);

    if (@isNaN(newHighWaterMark) || newHighWaterMark < 0)
        @throwRangeError("highWaterMark value is negative or not a number");

    return { size: size, highWaterMark: newHighWaterMark };
}

@linkTimeConstant
function createFIFO() {
    "use strict";
    var slice = @Array.prototype.slice;

    class Denqueue {
        constructor() {
          this._head = 0;
          this._tail = 0;
          // this._capacity = 0;
          this._capacityMask = 0x3;
          this._list = @newArrayWithSize(4);
        }

        _head;
        _tail;
        _capacityMask;
        _list;
  
        size() {
          if (this._head === this._tail) return 0;
          if (this._head < this._tail) return this._tail - this._head;
          else return this._capacityMask + 1 - (this._head - this._tail);
        }

        isEmpty() {
            return this.size() == 0;
        }

        isNotEmpty() {
            return this.size() > 0;
        }
  
        shift() {
            var { _head: head, _tail, _list, _capacityMask } = this;
            if (head === _tail) return @undefined;
            var item = _list[head];
            @putByValDirect(_list, head, @undefined);
            head = this._head = (head + 1) & _capacityMask;
            if (head < 2 && _tail > 10000 && _tail <= _list.length >>> 2) this._shrinkArray();
            return item;
        }

        peek() {
            if (this._head === this._tail) return @undefined;
            return this._list[this._head];
        }
  
        push(item) {
          var tail = this._tail;
          @putByValDirect(this._list, tail, item);
          this._tail = (tail + 1) & this._capacityMask;
          if (this._tail === this._head) {
            this._growArray();
          }
          // if (this._capacity && this.size() > this._capacity) {
            // this.shift();
          // }
        }
  
        toArray(fullCopy) {
          var list = this._list;
          var len = @toLength(list.length);
  
          if (fullCopy || this._head > this._tail) {
            var _head = @toLength(this._head);
            var _tail = @toLength(this._tail);
            var total = @toLength((len - _head) + _tail);
            var array = @newArrayWithSize(total);
            var j = 0;
            for (var i = _head; i < len; i++) @putByValDirect(array, j++, list[i]);
            for (var i = 0; i < _tail; i++) @putByValDirect(array, j++, list[i]);
            return array;
          } else {
            return slice.@call(list, this._head, this._tail);
          }
        }
        
        clear() {
            this._head = 0;
            this._tail = 0;
            this._list.fill(undefined);
        }

        _growArray() {
          if (this._head) {
            // copy existing data, head to end, then beginning to tail.
            this._list = this.toArray(true);
            this._head = 0;
          }
  
          // head is at 0 and array is now full, safe to extend
          this._tail = @toLength(this._list.length);
  
          this._list.length <<= 1;
          this._capacityMask = (this._capacityMask << 1) | 1;
        }
  
        shrinkArray() {
          this._list.length >>>= 1;
          this._capacityMask >>>= 1;
        }
      }

  
    return new Denqueue();
}

function newQueue()
{
    "use strict";

    return { content: @createFIFO(), size: 0 };
}

function dequeueValue(queue)
{
    "use strict";

    const record = queue.content.shift();
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
    
    queue.content.push({ value, size });
    queue.size += size;
}

function peekQueueValue(queue)
{
    "use strict";

    @assert(queue.content.isNotEmpty());

    return queue.peek()?.value;
}

function resetQueue(queue)
{
    "use strict";

    @assert("content" in queue);
    @assert("size" in queue);
    queue.content.clear();
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
