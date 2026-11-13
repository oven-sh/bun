function Mid() { this.more = 2; }
Object.defineProperty(Mid.prototype, "tell", { get() { return 1; }, configurable: true });
const mid = new Mid();
const before = mid.tell;
function lay(holder) { Object.defineProperty(holder, "tell", { get() { return 2; }, configurable: true }); }
lay(Mid.prototype);
console.log(before, mid.tell, new Mid().tell);
