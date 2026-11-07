// A proxy whose handler counts the reads and answers out of the target, made by the function that reads through it, beside the same handler called by hand. A read through the proxy is a call of the trap: the run time is not asked.
// COUNT: arrivals <= 300
// COUNT: branches <= 14600
// COUNT: operations <= 300
// COUNT: cells <= 300
class Counting {
  constructor() {
    this.reads = 0;
  }
  get(target, key) {
    this.reads++;
    return target[key];
  }
}
const handler = new Counting(),
  target = { alpha: 1, beta: 2 };
function byHand() {
  const proxy = new Proxy(target, handler);
  let sum = 0;
  for (let i = 0; i < 1000; i++)
    sum = (sum + handler.get(target, "alpha", proxy) + handler.get(target, "beta", proxy) + i) | 0;
  return sum;
}
function throughTheProxy() {
  const proxy = new Proxy(target, handler);
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + proxy.alpha + proxy.beta + i) | 0;
  return sum;
}
console.log(byHand(), throughTheProxy(), handler.reads);
