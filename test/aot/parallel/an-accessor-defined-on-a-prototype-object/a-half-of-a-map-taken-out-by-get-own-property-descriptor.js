function Reply() { this.flag = 1; }
Object.defineProperties(Reply.prototype, { sent: { get() { return this.flag; }, set(value) { this.flag = value; } } });
const found = Object.getOwnPropertyDescriptor(Reply.prototype, "sent");
const other = { flag: 12 };
found.set.call(other, found.get.call(other) + 1);
console.log(other.flag, found.get.call("text"), new Reply().flag);
