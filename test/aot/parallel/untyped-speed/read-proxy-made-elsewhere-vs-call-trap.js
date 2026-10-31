// A function makes the proxy, an object keeps it, and another function reads two names through it. Beside it the same trap called by hand. A read through the proxy is a call of the trap: the run time is not asked.
// COUNT: arrivals = 0
// COUNT: branches <= 9600
// COUNT: operations <= 300
// COUNT: cells <= 300
let reads = 0;
const handler = {
  get(target, key) {
    reads++;
    return target[key];
  },
};
function make(target) {
  return new Proxy(target, handler);
}
const target = { alpha: 1, beta: 2 },
  holder = { kept: make(target) };
function readThrough(from) {
  return from.kept.alpha + from.kept.beta;
}
function readByHand(from) {
  return handler.get(target, "alpha", from.kept) + handler.get(target, "beta", from.kept);
}
function byHand() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + readByHand(holder) + i) | 0;
  return sum;
}
function throughTheProxy() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + readThrough(holder) + i) | 0;
  return sum;
}
console.log(byHand(), throughTheProxy(), reads);
