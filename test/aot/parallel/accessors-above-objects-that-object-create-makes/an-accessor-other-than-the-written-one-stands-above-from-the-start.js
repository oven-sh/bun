const reply = {
  get code() { return this.out; },
  set code(value) { this.out = value; },
};
globalThis.held = [reply];
Object.defineProperty(globalThis.held[0], ["c", "o", "d", "e"].join(""), { get() { return "another getter"; }, set(value) { this.out = "another setter"; }, configurable: true });
class Server {
  constructor() { this.reply = Object.create(reply); }
  make(out) {
    const made = Object.create(this.reply);
    made.out = out;
    return made;
  }
}
const server = new Server();
const lines = [];
for (let i = 0; i < 120; i++) {
  const made = server.make(i);
  const read = made.code;
  made.code = i + 1;
  if (i < 4 || i >= 118) lines.push([i, read, made.out, Object.keys(made).join()].join(" "));
}
console.log(lines.join("\n"));
