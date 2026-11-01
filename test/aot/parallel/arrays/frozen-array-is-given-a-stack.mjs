// Error.captureStackTrace() defines `stack` on a frozen array as on any object. Its elements and its length stay read-only.
const target = Object.freeze([1, 2, 3]);
Error.captureStackTrace(target);
function attempt(label, run) {
  try {
    console.log(label + ":", run());
  } catch (error) {
    console.log(label + ": throws", error.constructor.name);
  }
}
attempt("keys", () => Reflect.ownKeys(target).join());
attempt("stack", () => typeof target.stack);
attempt("closed", () => [Object.isFrozen(target), Object.isSealed(target), Object.isExtensible(target)].join());
attempt("store to an element", () => {
  target[0] = 9;
  return target[0];
});
attempt("new element", () => {
  target[3] = 9;
  return target.length;
});
attempt("push", () => target.push(4));
attempt("pop", () => target.pop());
attempt("length", () => {
  target.length = 0;
  return target.length;
});
attempt("delete an element", () => delete target[0]);
attempt("new name", () => {
  target.other = 1;
  return target.other;
});
attempt("store to stack", () => {
  target.stack = "mine";
  return target.stack;
});
attempt("delete stack", () => delete target.stack);
attempt("keys", () => Reflect.ownKeys(target).join());
attempt("a second time", () => {
  Error.captureStackTrace(target);
  return typeof target.stack;
});
attempt("sum", () => {
  let sum = 0;
  for (const value of target) sum += value;
  return sum;
});
attempt("map", () => target.map(value => value * 2).join());
attempt("descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(target, 0)));
attempt("JSON", () => JSON.stringify(target));
