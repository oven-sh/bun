let reads = 0;
function Reply(fails) { this.fails = fails; }
Object.defineProperty(Reply.prototype, "sent", {
    get() {
        reads++;
        if (this.fails)
            throw new RangeError("no");
        return reads;
    },
});
function ask(reply) {
    const before = reads;
    try {
        return reply.sent + ":" + (reads - before);
    } catch (error) {
        return error.name + ":" + (reads - before);
    }
}
console.log(ask(new Reply(false)), ask(new Reply(true)), ask(new Reply(false)));
