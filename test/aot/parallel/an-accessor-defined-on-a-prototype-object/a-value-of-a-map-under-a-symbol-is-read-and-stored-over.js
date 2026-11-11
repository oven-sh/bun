const kCalled = Symbol("called");
function Reply() { this.flag = 1; }
Object.defineProperties(Reply.prototype, {
    [kCalled]: { value: false, writable: true },
    fixed: { value: 3 },
    sent: { get() { return this.flag; } },
});
function ask(reply) { return reply[kCalled] + ":" + reply.fixed + ":" + reply.sent; }
const reply = new Reply();
console.log(ask(reply));
reply[kCalled] = true;
try { reply.fixed = 4; } catch (error) { console.log(error.constructor.name); }
console.log(ask(reply), ask(new Reply()), Object.getOwnPropertySymbols(reply).length, Object.keys(reply).join());
