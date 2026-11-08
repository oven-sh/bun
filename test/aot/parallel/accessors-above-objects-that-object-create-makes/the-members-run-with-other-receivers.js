const reply = {
  get code() { return this.out.code; },
  set code(value) { this.out.code = value; },
  get sent() { return this.out.sent; },
  get text() { return this.kept; },
  set text(value) {
    this.kept = value;
    if (value == null) { this.code = 204; return; }
    if (!this.sent) this.code = 200;
    this.size = value.length;
  },
};
class Server {
  constructor() { this.reply = Object.create(reply); }
  make(out) {
    const made = Object.create(this.reply);
    made.server = this;
    made.out = out;
    made.size = 0;
    return made;
  }
}
const server = new Server();
const lines = [];
function turn(i) {
  const made = server.make({ code: 404, sent: false });
  made.text = i & 3 ? "hello" : null;
  return [made.code, made.size, made.text, made.sent, Object.keys(made).join()].join(" ");
}
const other = { out: { code: 1, sent: true }, kept: "of another object" };
for (let i = 0; i < 120; i++) {
  const line = turn(i);
  const getter = Object.getOwnPropertyDescriptor(reply, "text").get;
  const setter = Object.getOwnPropertyDescriptor(reply, "text").set;
  if (i % 40 === 20) {
    setter.call(other, "four");
    lines.push([getter.call(other), other.size, other.out.code, Reflect.get(reply, "code", other), Reflect.get(reply, "sent", { out: { sent: i } })].join(" "));
    try { lines.push(String(reply.code)); } catch (error) { lines.push(error.constructor.name); }
  }
  if (i < 2 || i === 119) lines.push(i + ": " + line);
}
console.log(lines.join("\n"));
