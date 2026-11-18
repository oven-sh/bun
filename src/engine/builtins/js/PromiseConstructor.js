// @constructor
function Promise(executor) {
  if (!@isCallable(executor)) @throwTypeError("Promise constructor takes a function argument");
  var promise = @createPromise(this);
  var captured = promise;
  try {
    executor(
      (resolution) => @resolvePromiseWithFirstResolvingFunctionCallCheck(captured, resolution),
      (reason) => @rejectPromiseWithFirstResolvingFunctionCallCheck(captured, reason),
    );
  } catch (error) {
    @rejectPromiseWithFirstResolvingFunctionCallCheck(promise, error);
  }
  return promise;
}

function try(callback, ...args) {
  if (!@isObject(this)) @throwTypeError("|this| is not an object");
  var value;
  try {
    value = callback.@apply(@undefined, args);
  } catch (error) {
    return @promiseReject(this, error);
  }
  return @promiseResolve(this, value);
}
