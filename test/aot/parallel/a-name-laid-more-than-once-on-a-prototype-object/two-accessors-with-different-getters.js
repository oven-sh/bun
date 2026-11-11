function Mid() { this.more = 2; }
Object.defineProperty(Mid.prototype, "tell", { get() { return 1; }, configurable: true });
const mid = new Mid();
const before = mid.tell;
Object.defineProperty(Mid.prototype, "tell", { get() { return 2; }, configurable: true });
console.log(before, mid.tell, new Mid().tell);
