// `constructor` is only the holder of a further read here, and the further read is Symbol.for, kept and called later.
const made = Symbol("made");
const register = made.constructor.for;
const mark = register("nodejs.util.inspect.custom");
console.log({ [mark]: (depth, options, inspect) => "shown with " + inspect([1, [2]], { depth: 0 }) });
