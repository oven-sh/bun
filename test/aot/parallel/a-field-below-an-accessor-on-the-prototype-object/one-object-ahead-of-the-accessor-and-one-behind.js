function P(n) { this.n = n; }
const log = [], one = new P(1); Object.defineProperty(P.prototype, "n", { set(v) { log.push(v); }, get() { return "got"; }, configurable: true }); const two = new P(2);
console.log(one.n, two.n, Object.keys(two).join() + "|", "n" in two, log.join());
