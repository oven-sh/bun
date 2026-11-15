function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { configurable: true, get() { return this.flag; } });
function ask(reply) { return reply.sent; }
const reply = new Reply();
console.log(ask(reply), "sent" in reply);
delete Reply.prototype.sent;
console.log(ask(reply), ask(new Reply()), "sent" in reply);
