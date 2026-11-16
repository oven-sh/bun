function Reply() { this.flag = 1; }
function ask(reply) { return reply.sent; }
function fill(reply, value) { reply.sent = value; }
const early = new Reply();
const stored = new Reply();
console.log(ask(early));
fill(stored, "own");
Object.defineProperty(Reply.prototype, "sent", { get() { return this.flag; }, set(value) { this.flag = value; } });
console.log(ask(early), ask(stored), ask(new Reply()), Object.keys(stored).join(), JSON.stringify(stored));
fill(early, 7);
console.log(ask(early), early.flag, Object.keys(early).join());
