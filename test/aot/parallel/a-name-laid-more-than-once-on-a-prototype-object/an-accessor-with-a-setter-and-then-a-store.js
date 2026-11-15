const log = [];
function Mid() { this.more = 2; }
Object.defineProperty(Mid.prototype, "tell", { get() { return 7; }, set(v) { log.push(typeof v); }, configurable: true });
const mid = new Mid();
Mid.prototype.tell = () => 9;
console.log(mid.tell, log.join(), Object.getOwnPropertyDescriptor(Mid.prototype, "tell").value);
