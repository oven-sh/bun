const first = Symbol("first");
const second = Symbol("second");
function Reply() { this.flag = 1; }
function lay(key) {
    Object.defineProperties(Reply.prototype, { [key]: { get() { return this.flag + 1; } } });
}
lay(first);
lay(second);
function ask(reply) { return reply[first] + reply[second]; }
let sum = 0;
for (let turn = 0; turn < 10; turn++)
    sum += ask(new Reply());
console.log(sum);
