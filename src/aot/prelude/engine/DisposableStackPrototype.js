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

// https://tc39.es/proposal-explicit-resource-management/#sec-createdisposableresource
$linkTimeConstant;
export function createDisposableResource(value, isAsync /* , method */)
{
    'use strict';

    var method;
    if ($argumentCount() < 3) {
        if ($isUndefinedOrNull(value))
            value = undefined;
        else {
            if (!$isObject(value))
                throw new TypeError("Disposable value must be an object");
            if (isAsync)
                method = $getAsyncDisposeMethod(value);
            else
                method = $getDisposeMethod(value);
        }
    } else {
        method = $argument(2);
        if (!$isCallable(method))
            throw new TypeError("Callback that is called on dispose must be callable");
    }

    return { value, method };
}

// https://tc39.es/proposal-explicit-resource-management/#sec-getdisposemethod
$linkTimeConstant;
export function getDisposeMethod(value)
{
    'use strict';

    if ($isUndefinedOrNull(value))
        return undefined;
    if (!$isObject(value))
        throw new TypeError("Disposable value must be an object, null, or undefined");
    var method = value[Symbol.dispose];
    if ($isUndefinedOrNull(method))
        throw new TypeError("@@dispose must not be undefined or null");
    if (!$isCallable(method))
        throw new TypeError("@@dispose must be callable");
    return method;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-getdisposemethod (async-dispose hint)
$linkTimeConstant;
export function getAsyncDisposeMethod(value)
{
    'use strict';

    if ($isUndefinedOrNull(value))
        return undefined;
    if (!$isObject(value))
        throw new TypeError("Disposable value must be an object, null, or undefined");

    var method = value[Symbol.asyncDispose];
    if ($isUndefinedOrNull(method)) {
        method = value[Symbol.dispose];
        if ($isUndefinedOrNull(method))
            throw new TypeError("@@asyncDispose and @@dispose must not be undefined or null");
        if (!$isCallable(method))
            throw new TypeError("@@dispose must be callable");
        var syncMethod = method;
        var receiver = value;
        return function () {
            try {
                syncMethod.$call(receiver);
            } catch (e) {
                return $promiseReject($Promise, e);
            }
            return $promiseResolve($Promise, undefined);
        };
    }
    if (!$isCallable(method))
        throw new TypeError("@@asyncDispose must be callable");
    return method;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-adddisposableresource
$linkTimeConstant;
export function addDisposableResource(disposeCapability, value, isAsync /* , method */)
{
    'use strict';

    $assert($isArray(disposeCapability));

    var resource;
    if ($argumentCount() < 4) {
        if ($isUndefinedOrNull(value) && !isAsync)
            return;
        resource = $createDisposableResource(value, isAsync);
    } else {
        $assert(value === undefined);
        resource = $createDisposableResource(undefined, isAsync, $argument(3));
    }

    $arrayPush(disposeCapability, resource);
}

// https://tc39.es/proposal-explicit-resource-management/#sec-disposablestack.prototype.adopt
export function adopt(value, onDispose)
{
    'use strict';

    if (!$isDisposableStack(this))
        throw new TypeError("DisposableStack.prototype.adopt requires that |this| be a DisposableStack object");

    if ($getDisposableStackInternalField(this, $disposableStackFieldState) === $DisposableStackStateDisposed)
        throw new $ReferenceError("DisposableStack.prototype.adopt requires that |this| be a pending DisposableStack object");

    if (!$isCallable(onDispose))
        throw new TypeError("DisposableStack.prototype.adopt requires that onDispose argument be a callable");

    var closure = () => { onDispose.$call(undefined, value); }
    $addDisposableResource($getDisposableStackInternalField(this, $disposableStackFieldCapability), undefined, /* isAsync */ false, closure);

    return value;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-disposablestack.prototype.defer
$overriddenName = "defer";
export function deferMethod(onDispose)
{
    'use strict';

    if (!$isDisposableStack(this))
        throw new TypeError("DisposableStack.prototype.defer requires that |this| be a DisposableStack object");

    if ($getDisposableStackInternalField(this, $disposableStackFieldState) === $DisposableStackStateDisposed)
        throw new $ReferenceError("DisposableStack.prototype.defer requires that |this| be a pending DisposableStack object");

    if (!$isCallable(onDispose))
        throw new TypeError("DisposableStack.prototype.defer requires that onDispose argument be a callable");

    $addDisposableResource($getDisposableStackInternalField(this, $disposableStackFieldCapability), undefined, /* isAsync */ false, onDispose);

    return undefined;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-disposablestack.prototype.dispose
export function dispose()
{
    'use strict';

    if (!$isDisposableStack(this))
        throw new TypeError("DisposableStack.prototype.dispose requires that |this| be a DisposableStack object");

    if ($getDisposableStackInternalField(this, $disposableStackFieldState) === $DisposableStackStateDisposed)
        return undefined;

    $putDisposableStackInternalField(this, $disposableStackFieldState, $DisposableStackStateDisposed);

    var stack = $getDisposableStackInternalField(this, $disposableStackFieldCapability);
    $assert($isArray(stack));

    var i = stack.length;
    var thrown = false;
    var suppressed;

    while (i) {
        var resource = stack[--i];
        try {
            resource.method.$call(resource.value);
        } catch (e) {
            if (thrown)
                suppressed = new $SuppressedError(e, suppressed);
            else {
                thrown = true;
                suppressed = e;
            }
        }
    }

    $putDisposableStackInternalField(this, $disposableStackFieldCapability, []);
    if (thrown)
        throw suppressed;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-disposablestack.prototype.move
export function move()
{
    'use strict';

    if (!$isDisposableStack(this))
        throw new TypeError("DisposableStack.prototype.move requires that |this| be a DisposableStack object");

    if ($getDisposableStackInternalField(this, $disposableStackFieldState) === $DisposableStackStateDisposed)
        throw new $ReferenceError("DisposableStack.prototype.move requires that |this| be a pending DisposableStack object");

    var newDisposableStack = new $DisposableStack();
    $putDisposableStackInternalField(newDisposableStack, $disposableStackFieldCapability, $getDisposableStackInternalField(this, $disposableStackFieldCapability));

    $putDisposableStackInternalField(this, $disposableStackFieldCapability, []);
    $putDisposableStackInternalField(this, $disposableStackFieldState, $DisposableStackStateDisposed);

    return newDisposableStack;
}

// https://tc39.es/proposal-explicit-resource-management/#sec-disposablestack.prototype.use
export function use(value)
{
    'use strict';

    if (!$isDisposableStack(this))
        throw new TypeError("DisposableStack.prototype.use requires that |this| be a DisposableStack object");

    if ($getDisposableStackInternalField(this, $disposableStackFieldState) === $DisposableStackStateDisposed)
        throw new $ReferenceError("DisposableStack.prototype.use requires that |this| be a pending DisposableStack object");

    $addDisposableResource($getDisposableStackInternalField(this, $disposableStackFieldCapability), value, /* isAsync */ false);

    return value;
}
