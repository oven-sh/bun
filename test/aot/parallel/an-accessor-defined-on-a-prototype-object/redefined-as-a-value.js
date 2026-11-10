function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { configurable: true, get() { return this.flag; } });
function ask(reply) { return reply.sent; }
const reply = new Reply();
console.log(ask(reply));
Object.defineProperty(Reply.prototype, "sent", { configurable: true, writable: true, value: "laid" });
console.log(ask(reply), ask(new Reply()));
reply.sent = "own";
console.log(ask(reply), ask(new Reply()), Object.keys(reply).join());
