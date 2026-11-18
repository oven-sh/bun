function disposeAsync() {
  return @disposeAsyncStack(this);
}

// @private
async function disposeAsyncStack(stack) {
  if (!@isAsyncDisposableStack(stack))
    @throwTypeError("AsyncDisposableStack.prototype.disposeAsync requires that |this| be a AsyncDisposableStack object");
  var resources = @getInternalField(stack, 0);
  if (resources === null) return;
  @putInternalField(stack, 0, null);
  var hasThrown = false;
  var hasAwaited = false;
  var needsAwait = false;
  var error;
  for (var i = resources.length; i; i -= 2) {
    var method = resources[i - 1];
    if (method === @undefined) {
      needsAwait = true;
      continue;
    }
    try {
      var result = method.@call(resources[i - 2]);
      hasAwaited = true;
      await result;
    } catch (caught) {
      error = hasThrown ? new @SuppressedError(caught, error) : caught;
      hasThrown = true;
    }
  }
  if (needsAwait && !hasAwaited) await @undefined;
  if (hasThrown) throw error;
}
