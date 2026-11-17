function Reply() { this.flag = 1; }
function describe(text) { return { get() { return text + this.flag; } }; }
Object.defineProperties(Reply.prototype, {
    sent: { get() { return this.flag; } },
    made: describe("made"),
});
function ask(reply) { return reply.sent + " " + reply.made; }
console.log(ask(new Reply()));
