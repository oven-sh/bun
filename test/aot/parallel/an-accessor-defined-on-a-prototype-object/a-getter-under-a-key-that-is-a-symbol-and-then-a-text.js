const first = Symbol("first");
function Reply() { this.flag = 1; }
function lay(key) {
    Object.defineProperties(Reply.prototype, { [key]: { get() { return this.flag + 1; } } });
}
lay(first);
lay("sent");
function ask(reply) { return reply[first] + reply.sent; }
let sum = 0;
for (let turn = 0; turn < 10; turn++)
    sum += ask(new Reply());
console.log(sum);
