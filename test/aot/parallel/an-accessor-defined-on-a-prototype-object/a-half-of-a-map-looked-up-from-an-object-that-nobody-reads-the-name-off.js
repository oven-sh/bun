function Reply() { this.flag = 1; }
Object.defineProperties(Reply.prototype, { sent: { get() { return this.flag; }, set(value) { this.flag = value; } } });
const reply = new Reply();
const getter = reply.__lookupGetter__("sent");
const setter = reply.__lookupSetter__("sent");
const other = { flag: 12 };
setter.call(other, getter.call(other) + 1);
console.log(other.flag, getter.call(reply), typeof setter);
