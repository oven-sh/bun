const kSent = Symbol("sent");
function Reply(sent) { this[kSent] = sent; }
Object.defineProperty(Reply.prototype, "sent", { enumerable: true, get() { return this[kSent]; } });
function ask(reply) { return reply.sent; }
let count = 0;
for (let turn = 0; turn < 10; turn++) count += ask(new Reply(turn % 3 === 0)) ? 1 : 0;
const names = [];
for (const name in new Reply(true)) names.push(name);
console.log(count, names.join(), Object.keys(Reply.prototype).join(), JSON.stringify(new Reply(true)));
