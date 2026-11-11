function Reply() { this.flag = 1; }
Object.defineProperty(Reply.prototype, "sent", { get() { return this.flag; }, set(value) { this.flag = value; } });
class Wrapped extends Reply {
    extra = 2;
    get twice() { return super.sent * 2; }
}
function ask(reply) { return reply.sent; }
const wrapped = new Wrapped();
console.log(ask(wrapped), wrapped.twice, ask(new Reply()));
wrapped.sent = 8;
console.log(ask(wrapped), wrapped.twice, Object.keys(wrapped).join());
