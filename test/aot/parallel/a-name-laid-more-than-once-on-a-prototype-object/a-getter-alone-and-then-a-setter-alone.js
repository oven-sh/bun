const log = [];
function Mid() { this.more = 2; }
Object.defineProperty(Mid.prototype, "tell", { get() { return 7; }, configurable: true });
const mid = new Mid();
Object.defineProperty(Mid.prototype, "tell", { set(v) { log.push(v); } });
mid.tell = 5;
console.log(mid.tell, log.join(), Object.keys(mid).join());
