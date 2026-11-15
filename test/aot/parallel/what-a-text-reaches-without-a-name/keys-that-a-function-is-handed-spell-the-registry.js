// Two keys that nobody knows spell `constructor` and `for`: no evaluator is needed to lay a method for the printer.
const pick = (of, name) => of[name];
const mark = pick(pick(Symbol.iterator, "constructor"), "for")("nodejs.util.inspect.custom");
console.log({ [mark]: (depth, options, inspect) => "shown with " + inspect([1, [2]], { depth: 0 }) });
