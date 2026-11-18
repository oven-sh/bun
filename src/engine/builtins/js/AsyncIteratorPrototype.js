// @name [Symbol.asyncDispose]
function asyncDispose() {
  try {
    var method = this.return;
    if (@isUndefinedOrNull(method)) return @promiseResolve(@Promise, @undefined);
    var result = @promiseResolve(@Promise, method.@call(this));
  } catch (error) {
    return @promiseReject(@Promise, error);
  }
  var promise = @newPromise();
  @performPromiseThen(result, () => {}, @undefined, promise);
  return promise;
}
