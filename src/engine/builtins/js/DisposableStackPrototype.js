function dispose() {
  if (!@isDisposableStack(this))
    @throwTypeError("DisposableStack.prototype.dispose requires that |this| be a DisposableStack object");
  var resources = @getInternalField(this, 0);
  if (resources === null) return;
  @putInternalField(this, 0, null);
  var hasThrown = false;
  var error;
  for (var i = resources.length; i; i -= 2) {
    try {
      resources[i - 1].@call(resources[i - 2]);
    } catch (caught) {
      error = hasThrown ? new @SuppressedError(caught, error) : caught;
      hasThrown = true;
    }
  }
  if (hasThrown) throw error;
}
