// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// Every constructor of errors that the engine has.
for (const Base of [Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError]) {
  function Old(text) {
    return Reflect.construct(Base, [text], new.target ?? Old);
  }
  Old.prototype = Object.create(Base.prototype);
  console.log(Base.name, typeof Old("a").stack, typeof new Old("b").stack);
}
function Many(text) {
  return Reflect.construct(AggregateError, [[], text], new.target ?? Many);
}
Many.prototype = Object.create(AggregateError.prototype);
console.log("AggregateError", typeof Many("a").stack, typeof new Many("b").stack);
