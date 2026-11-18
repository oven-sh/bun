function next() {
  if (!@isWrapForValidIterator(this))
    @throwTypeError("%WrapForValidIteratorPrototype%.next requires that |this| be a WrapForValidIteratorPrototype object");
  var method = @getInternalField(this, @wrapForValidIteratorFieldIteratedNextMethod);
  return method.@call(@getInternalField(this, @wrapForValidIteratorFieldIteratedIterator));
}

function return() {
  if (!@isWrapForValidIterator(this))
    @throwTypeError("%WrapForValidIteratorPrototype%.next requires that |this| be a WrapForValidIteratorPrototype object");
  var iterator = @getInternalField(this, @wrapForValidIteratorFieldIteratedIterator);
  var method = iterator.return;
  if (@isUndefinedOrNull(method)) return { value: @undefined, done: true };
  return method.@call(iterator);
}
