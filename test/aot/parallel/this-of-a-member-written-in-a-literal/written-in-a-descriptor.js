// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
function Reply() { this.sent = false; this.code = 198 + Math.min(process.argv.length, 2); }
const byName = { get() { return this.code; } };
Object.defineProperty(Reply.prototype, "status", byName);
Object.defineProperties(Reply.prototype, {
  done: { get() { return this.sent; }, set(value) { this.sent = value; } },
  ["computed" + 1]: { get() { return this.code + 1; } },
});
globalThis.kept = Reply;
const reply = new Reply();
reply.done = true;
console.log(reply.status, reply.done, reply.computed1);
