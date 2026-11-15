let stored = 0;
const reply = { set mark(v) { let work = 0; for (let j = 0; j < 2; j++) work = (work + j) | 0; stored = (stored + v + work) | 0; }, get code() { let work = 0; for (let j = 0; j < 2; j++) work = (work + j) | 0; return this.out.status + work; } };
class Server {
  constructor() { this.reply = Object.create(reply); }
  make(out) { const made = Object.create(this.reply); made.server = this; made.out = out; return made; }
}
const server = new Server();
function at(object, key) { return object[key]; }
function put(object, key, value) { object[key] = value; }
function turn(i) {
  const made = server.make({ status: 400 + (i & 3) });
  let sum = 0; put(made, "mark", i);
  for (let j = 0; j < 2; j++) sum = (sum + at(made, "code")) | 0;
  return sum;
}
const lines = [];
for (let i = 0; i < 120; i++) { const line = turn(i); if (i < 2 || i === 119) lines.push(i + ": " + line); }
console.log(lines.join("\n"), stored);
