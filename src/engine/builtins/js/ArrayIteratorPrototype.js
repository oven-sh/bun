function next() {
  if (!@isArrayIterator(this))
    @throwTypeError("%ArrayIteratorPrototype%.next requires that |this| be an Array Iterator instance");
  var index = @getInternalField(this, @arrayIteratorFieldIndex);
  if (index === -1) return { value: @undefined, done: true };
  return @arrayIteratorStep(this, @getInternalField(this, @arrayIteratorFieldIteratedObject), index);
}

// @private
// @alwaysInline
function arrayIteratorStep(iterator, object, index) {
  var length;
  if (@isJSArray(object)) length = object.length;
  else if (@isTypedArrayView(object)) length = @typedArrayLength(object);
  else length = @toLength(object.length);
  var value;
  var done = index >= length;
  if (done) @putInternalField(iterator, @arrayIteratorFieldIndex, -1);
  else {
    @putInternalField(iterator, @arrayIteratorFieldIndex, index + 1);
    var kind = @getInternalField(iterator, @arrayIteratorFieldKind);
    if (kind === @iterationKindKey) value = index;
    else {
      value = object[index];
      if (kind === @iterationKindEntries) value = [index, value];
    }
  }
  return { value, done };
}
