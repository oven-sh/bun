function Top() { this.size = 1; }
Top.prototype.tell = function () { return 1; };
function Mid() { Top.call(this); this.more = 2; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
Object.defineProperty(Mid.prototype, "tell", { get() { return 7; }, configurable: true });
const mid = new Mid();
const before = mid.tell;
delete Mid.prototype.tell;
console.log(before, typeof mid.tell, mid.tell());
