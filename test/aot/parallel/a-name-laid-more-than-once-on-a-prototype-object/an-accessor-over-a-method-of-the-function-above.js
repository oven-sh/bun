function Top() { this.size = 1; }
Top.prototype.tell = function () { return 1; };
function Mid() { Top.call(this); this.more = 2; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
const top = new Top(), mid = new Mid();
const before = mid.tell();
Object.defineProperty(Mid.prototype, "tell", { get() { return 7; }, configurable: true });
console.log(before, mid.tell, top.tell(), new Mid().tell);
