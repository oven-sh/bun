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
for (let i = 0; i < 120; i++) {
  if (i === 60) {
    delete reply.code;
  }
  const line = turn(i);
  if (i < 2 || (i >= 59 && i < 63) || i === 119) lines.push(i + ": " + line);
}
console.log(lines.join("\n"));
