function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { configurable: true, get() { return this.flag; } });
function ask(reply) { return reply.sent; }
const reply = new Reply();
console.log(ask(reply), ask(new Reply()));
Object.defineProperty(Reply.prototype, "sent", { configurable: true, get() { return this.flag + 10; } });
console.log(ask(reply), ask(new Reply()));
