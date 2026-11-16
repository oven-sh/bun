function Reply() { this.code = 200; this.stores = 0; }
Object.defineProperty(Reply.prototype, "statusCode", {
    get() { return this.code; },
    set(value) { this.code = value; this.stores++; },
});
function bump(reply) { reply.statusCode = reply.statusCode + 1; return reply.statusCode; }
const reply = new Reply();
let last = 0;
for (let turn = 0; turn < 5; turn++) last = bump(reply);
console.log(last, reply.code, reply.stores, Object.keys(reply).join());
