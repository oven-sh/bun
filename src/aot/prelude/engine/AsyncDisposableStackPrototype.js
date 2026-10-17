/*
 * Copyright (C) 2025 Sosuke Suzuki <aosukeke@gmail.com>.
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

// https://tc39.es/proposal-explicit-resource-management/#sec-asyncdisposablestack.prototype.adopt
export function adopt(value, onAsyncDispose)
{
    'use strict';

    if (!$isAsyncDisposableStack(this))
        throw new TypeError("AsyncDisposableStack.prototype.adopt requires that |this| be a AsyncDisposableStack object");

    if ($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldState) === $AsyncDisposableStackStateDisposed)
        throw new $ReferenceError("AsyncDisposableStack.prototype.adopt requires that |this| be a pending AsyncDisposableStack object");

    if (!$isCallable(onAsyncDispose))
        throw new TypeError("AsyncDisposableStack.prototype.adopt requires that onAsyncDispose argument be a callable");

    var closure = () => onAsyncDispose.$call(undefined, value);
    $addDisposableResource($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldCapability), undefined, /* isAsync */ true, closure);

    return value;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-asyncdisposablestack.prototype.defer
$overriddenName = "defer";
export function deferMethod(onAsyncDispose)
{
    'use strict';

    if (!$isAsyncDisposableStack(this))
        throw new TypeError("AsyncDisposableStack.prototype.defer requires that |this| be a AsyncDisposableStack object");

    if ($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldState) === $AsyncDisposableStackStateDisposed)
        throw new $ReferenceError("AsyncDisposableStack.prototype.defer requires that |this| be a pending AsyncDisposableStack object");

    if (!$isCallable(onAsyncDispose))
        throw new TypeError("AsyncDisposableStack.prototype.defer requires that onAsyncDispose argument be a callable");

    $addDisposableResource($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldCapability), undefined, /* isAsync */ true, onAsyncDispose);

    return undefined;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-asyncdisposablestack.prototype.disposeAsync
export function disposeAsync()
{
    'use strict';

    var promise = $newPromise();

    if (!$isAsyncDisposableStack(this)) {
        $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, $makeTypeError("AsyncDisposableStack.prototype.disposeAsync requires that |this| be a AsyncDisposableStack object"));
        return promise;
    }

    if ($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldState) === $AsyncDisposableStackStateDisposed) {
        $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, undefined);
        return promise;
    }

    $putAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldState, $AsyncDisposableStackStateDisposed);

    var stack = $getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldCapability);
    $assert($isArray(stack));

    var i = stack.length;
    var thrown = false;
    var suppressed;
    var needsAwait = false;
    var hasAwaited = false;

    var handleError = (result) => {
        if (thrown)
            suppressed = new $SuppressedError(result, suppressed);
        else {
            thrown = true;
            suppressed = result;
        }
        loop();
    };

    var finish = () => {
        if (thrown)
            $rejectPromiseWithFirstResolvingFunctionCallCheck(promise, suppressed);
        else
            $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, undefined);
    };

    var loop = () => {
        while (i) {
            var resource = stack[--i];
            if (resource.method === undefined) {
                needsAwait = true;
                continue;
            }
            var result;
            try {
                result = resource.method.$call(resource.value);
            } catch (error) {
                if (thrown)
                    suppressed = new $SuppressedError(error, suppressed);
                else {
                    thrown = true;
                    suppressed = error;
                }
                continue;
            }
            hasAwaited = true;
            $promiseResolve($Promise, result).$then(loop, handleError);
            return;
        }
        if (needsAwait && !hasAwaited)
            $promiseResolve($Promise, undefined).$then(finish, finish);
        else
            finish();
    };

    loop();

    $putAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldCapability, []);

    return promise;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-asyncdisposablestack.prototype.move
export function move()
{
    'use strict';

    if (!$isAsyncDisposableStack(this))
        throw new TypeError("AsyncDisposableStack.prototype.move requires that |this| be a AsyncDisposableStack object");

    if ($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldState) === $AsyncDisposableStackStateDisposed)
        throw new $ReferenceError("AsyncDisposableStack.prototype.move requires that |this| be a pending AsyncDisposableStack object");

    var newAsyncDisposableStack = new $AsyncDisposableStack();
    $putAsyncDisposableStackInternalField(newAsyncDisposableStack, $asyncDisposableStackFieldCapability, $getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldCapability));

    $putAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldCapability, []);
    $putAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldState, $AsyncDisposableStackStateDisposed);

    return newAsyncDisposableStack;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-asyncdisposablestack.prototype.use
export function use(value)
{
    'use strict';

    if (!$isAsyncDisposableStack(this))
        throw new TypeError("AsyncDisposableStack.prototype.use requires that |this| be a AsyncDisposableStack object");

    if ($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldState) === $AsyncDisposableStackStateDisposed)
        throw new $ReferenceError("AsyncDisposableStack.prototype.use requires that |this| be a pending AsyncDisposableStack object");

    $addDisposableResource($getAsyncDisposableStackInternalField(this, $asyncDisposableStackFieldCapability), value, /* isAsync */ true);

    return value;
}
