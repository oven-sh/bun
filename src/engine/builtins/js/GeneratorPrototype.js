// The generator is not executing.
// @private
// @alwaysInline
function generatorResume(generator, state, value, mode) {
  var done = true;
  if (state !== @GeneratorStateCompleted) {
    value = @resumeGenerator(generator, value, mode);
    state = @getInternalField(generator, @generatorFieldState);
    if (state === @GeneratorStateDelegate) return value;
    done = state === @GeneratorStateCompleted;
  }
  return { value, done };
}

function next(value) {
  if (!@isGenerator(this)) @throwTypeError("|this| should be a generator");
  var state = @getInternalField(this, @generatorFieldState);
  if (state === @GeneratorStateExecuting) @throwTypeError("Generator is executing");
  if (state === @GeneratorStateCompleted) value = @undefined;
  return @generatorResume(this, state, value, @GeneratorResumeModeNormal);
}

function return(value) {
  if (!@isGenerator(this)) @throwTypeError("|this| should be a generator");
  var state = @getInternalField(this, @generatorFieldState);
  if (state === @GeneratorStateExecuting) @throwTypeError("Generator is executing");
  return @generatorResume(this, state, value, @GeneratorResumeModeReturn);
}

function throw(exception) {
  if (!@isGenerator(this)) @throwTypeError("|this| should be a generator");
  var state = @getInternalField(this, @generatorFieldState);
  if (state === @GeneratorStateExecuting) @throwTypeError("Generator is executing");
  if (state === @GeneratorStateCompleted) throw exception;
  return @generatorResume(this, state, exception, @GeneratorResumeModeThrow);
}
