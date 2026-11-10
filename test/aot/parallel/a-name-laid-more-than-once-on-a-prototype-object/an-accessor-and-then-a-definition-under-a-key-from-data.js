function Mid() { this.more = 2; }
Object.defineProperty(Mid.prototype, "tell", { get() { return 7; }, configurable: true });
const mid = new Mid();
const before = mid.tell;
Object.defineProperty(Mid.prototype, JSON.parse('"tell"'), { value: () => 9, configurable: true });
console.log(before, typeof mid.tell, mid.tell());
