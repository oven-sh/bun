const first = { get code() { return "first " + this.out; }, set code(value) { this.out = value; } };
const second = { get code() { return "second " + this.out; }, set code(value) { this.out = value + 1; } };
class Server {
  constructor(which) { this.reply = which ? Object.create(first) : Object.create(second); }
  make(out) { const made = Object.create(this.reply); made.out = out; return made; }
}
const servers = [new Server(true), new Server(false)];
const lines = [];
for (let i = 0; i < 120; i++) {
  const made = servers[i & 1].make(i);
  made.code = i + 10;
  if (i < 4 || i >= 118) lines.push(i + " " + made.code);
}
console.log(lines.join("\n"));
