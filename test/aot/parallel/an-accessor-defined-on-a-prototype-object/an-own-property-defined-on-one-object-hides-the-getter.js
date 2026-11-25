function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { get() { return this.flag; } });
function ask(reply) { return reply.sent; }
const plain = new Reply();
const hidden = new Reply();
console.log(ask(plain), ask(hidden));
Object.defineProperty(hidden, "sent", { value: "own" });
console.log(ask(plain), ask(hidden));
