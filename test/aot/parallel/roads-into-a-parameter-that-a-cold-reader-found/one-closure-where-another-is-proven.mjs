const unseen = (0, eval)("(x) => x");
function one() { return 1; }
function two() { return 2; }
function call(fn) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return fn === undefined ? -1 : fn() + work - 1;
}
console.log(call(one));
console.log(call(unseen(two)));
