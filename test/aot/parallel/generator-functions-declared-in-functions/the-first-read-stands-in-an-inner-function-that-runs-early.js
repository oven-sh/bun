// made at first read with a shared place: the first read is an inner function's, ahead of the declaration's line and under a condition. plain: true true true
const n = +process.argv[2] || 3;
const above = made => Object.getPrototypeOf(made);
function f(flag) {
  "use strict";
  const early = () => gen();
  let first = null;
  if (flag) first = early();
  function* gen() { yield n; }
  const late = () => gen();
  const own = flag ? gen() : null;
  let inLoop = null;
  for (let i = 0; i < n; i++) inLoop = (() => gen())();
  return [above(first) === above(late()), above(own) === above(late()), above(inLoop) === above(first)].join(" ");
}
console.log(f(n > 0));
