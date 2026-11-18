// What compiled code calls, with a proxy for `this`, so that the lookup and the call of the trap are cached and inlined
// like any other. No key is private.

// @private
// @alwaysInline
function proxyHandler(proxy) {
  "use strict";
  var handler = @getProxyInternalField(proxy, @proxyFieldHandler);
  if (handler === null) @throwTypeError("Proxy has already been revoked. No more operations are allowed to be performed on it");
  return handler;
}

// @private
function proxyGet(key, receiver) {
  "use strict";
  var target = @getProxyInternalField(this, @proxyFieldTarget);
  var handler = @proxyHandler(this);
  var trap = handler.get;
  if (@isUndefinedOrNull(trap)) return @getByValWithThis(target, receiver, key);
  if (!@isCallable(trap)) @throwTypeError("'get' property of a Proxy's handler should be callable");
  var result = trap.@call(handler, target, key, receiver);
  if (@mustValidateResultOfProxyGetAndSetTraps(target)) @handleProxyGetTrapResult(result, target, key);
  return result;
}

// @private
function proxyHas(key) {
  "use strict";
  var target = @getProxyInternalField(this, @proxyFieldTarget);
  var handler = @proxyHandler(this);
  var trap = handler.has;
  if (@isUndefinedOrNull(trap)) return key in target;
  if (!@isCallable(trap)) @throwTypeError("'has' property of a Proxy's handler should be callable");
  if (trap.@call(handler, target, key)) return true;
  if (@mustValidateResultOfProxyTrapsExceptGetAndSet(target)) @handleNegativeProxyHasTrapResult(target, key);
  return false;
}

// @private
function proxySet(key, receiver, value, isStrict) {
  "use strict";
  var target = @getProxyInternalField(this, @proxyFieldTarget);
  var handler = @proxyHandler(this);
  var trap = handler.set;
  if (@isUndefinedOrNull(trap)) {
    if (isStrict) @putByValWithThisStrict(target, receiver, key, value);
    else @putByValWithThisSloppy(target, receiver, key, value);
    return;
  }
  if (!@isCallable(trap)) @throwTypeError("'set' property of a Proxy's handler should be callable");
  if (!trap.@call(handler, target, key, value, receiver)) {
    if (isStrict) @throwFalsyProxySetTrapResult(key);
  } else if (@mustValidateResultOfProxyGetAndSetTraps(target)) @handlePositiveProxySetTrapResult(target, key, value);
}
