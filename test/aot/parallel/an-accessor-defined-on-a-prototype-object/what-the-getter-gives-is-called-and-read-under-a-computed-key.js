function Reply() { this.flag = 3; }
Object.defineProperty(Reply.prototype, "adder", { get() { const flag = this.flag; return (value) => value + flag; } });
function call(reply) { return reply.adder(4); }
function read(reply, name) { return typeof reply[name]; }
console.log(call(new Reply()), read(new Reply(), "add" + "er"));
