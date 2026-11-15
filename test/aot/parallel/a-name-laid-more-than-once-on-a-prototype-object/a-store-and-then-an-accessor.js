function Mid() { this.more = 2; }
Mid.prototype.tell = () => 9;
const mid = new Mid();
const before = mid.tell();
Object.defineProperty(Mid.prototype, "tell", { get() { return 7; }, configurable: true });
console.log(before, mid.tell, new Mid().tell);
