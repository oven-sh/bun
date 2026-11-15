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
};
function wrap(inner) {
  const made = Object.create(shell);
  made.inner = inner;
  return made;
}
globalThis.kept = new Reply(seed);
let sum = 0;
const emitter = new EventEmitter();
emitter.on("reply", inner => {
  const made = wrap(inner);
  sum += made.status + (made.done ? 1 : 0);
});
for (let i = 0; i < 40; i++) emitter.emit("reply", JSON.parse('{"replyCode":' + (seed + i) + ',"isShut":true}'));
console.log(sum);
