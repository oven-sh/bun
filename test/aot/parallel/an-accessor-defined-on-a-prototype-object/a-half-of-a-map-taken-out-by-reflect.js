function Reply() { this.flag = 1; }
Object.defineProperties(Reply.prototype, { sent: { get() { return this.flag; } } });
const half = Reflect.getOwnPropertyDescriptor(Reply.prototype, "sent").get;
console.log(half.call({ flag: 12 }), half.call(7), Reflect.get(Reply.prototype, "sent", { flag: 9 }));
