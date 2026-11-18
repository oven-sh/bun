function next() {
  if (!@isIteratorHelper(this)) @throwTypeError("|this| should be an iterator helper");
  var generator = @getInternalField(this, @iteratorHelperFieldGenerator);
  var state = @getInternalField(generator, @generatorFieldState);
  if (state === @GeneratorStateExecuting) @throwTypeError("Generator is executing");
  return @generatorResume(generator, state, @undefined, @GeneratorResumeModeNormal);
}

function return() {
  if (!@isIteratorHelper(this)) @throwTypeError("|this| should be an iterator helper");
  var generator = @getInternalField(this, @iteratorHelperFieldGenerator);
  var state = @getInternalField(generator, @generatorFieldState);
  if (state === @GeneratorStateExecuting) @throwTypeError("Generator is executing");
  var result = @generatorResume(generator, state, @undefined, @GeneratorResumeModeReturn);
  if (state === @GeneratorStateInit) {
    var underlying = @getInternalField(this, @iteratorHelperFieldUnderlyingIterator);
    if (underlying !== null) @iteratorGenericClose(underlying);
  }
  return result;
}
