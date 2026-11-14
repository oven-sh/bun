const { kContext, kSent, kRequest } = require("./symbols");
function Reply(request) { this[kSent] = false; this[kRequest] = request; }
Object.defineProperties(Reply.prototype, {
    [kContext]: { get() { return this[kRequest]; } },
    sent: { enumerable: true, get() { return this[kSent]; } },
});
function ask(reply) { return reply.sent ? 0 : reply[kContext]; }
let sum = 0;
for (let turn = 0; turn < 10; turn++)
    sum += ask(new Reply(turn));
console.log(sum);
