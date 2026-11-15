const { EventEmitter } = require("node:events");
const seed = Number(process.argv[2] ?? 3);
class Reply {
  constructor(start) { this.replyCode = start; this.replySent = false; }
  askHeader(name) { return name.length + this.replyCode; }
  get isShut() { return this.replySent; }
}
const shell = {
  get status() { return this.inner.replyCode; },
  get done() { return this.inner.isShut; },
  ask(name) { return this.inner.askHeader(name); },
  mark(value) { this.inner.lateName = value; return this.inner.replyCode; },
};
function wrap(inner) {
  const made = Object.create(shell);
  made.inner = inner;
  return made;
}
let sum = 0;
const emitter = new EventEmitter();
emitter.on("reply", inner => {
  const made = wrap(inner);
  sum += made.status + made.ask("abc") + made.mark(sum);
});
for (let i = 0; i < 40; i++) emitter.emit("reply", new Reply(seed + i));
console.log(sum);
