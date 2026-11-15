function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { get() { return this === Reply.prototype ? "holder" : this.flag; } });
const created = Object.create(Reply.prototype);
created.flag = 4;
function ask(reply) { return reply.sent; }
console.log(ask(new Reply()), ask(created), Reply.prototype.sent, Reflect.get(Reply.prototype, "sent", { flag: 9 }));
const half = Object.getOwnPropertyDescriptor(Reply.prototype, "sent").get;
console.log(half.call({ flag: 12 }), typeof half);
