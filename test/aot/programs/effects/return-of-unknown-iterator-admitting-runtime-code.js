// The compiler knows nothing about a value that evaluated text made. Here such text wraps an iterator of the program, and `next` and `return` of the wrapper, which are not compiled, call back into compiled code: each line goes wrong if a read of a counter moves across the call.
let steps = 0;
let closes = 0;
const underlying = {
  next() {
    steps++;
    return { done: false, value: steps };
  },
  return() {
    closes++;
    return {};
  },
};
function close(iterator) {
  closes = 0;
  if (typeof iterator.return === "function") iterator.return();
  return closes;
}
function step(iterator) {
  steps = 0;
  iterator.next();
  return steps;
}
const wrap = new Function("underlying", "return Iterator.from(underlying)");
const help = new Function("underlying", "return Iterator.from(underlying).map(value => value)");
console.log(step(wrap(underlying)), close(wrap(underlying)));
console.log(step(help(underlying)), close(help(underlying)));
console.log(step(underlying), close(underlying), close({}));
