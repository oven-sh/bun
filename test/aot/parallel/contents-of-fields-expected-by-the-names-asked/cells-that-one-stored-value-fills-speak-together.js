const { EventEmitter } = require("node:events");
const seed = Number(process.argv[2] ?? 3);
class Reply {
  constructor(start) { this.replyCode = start; this.replySent = false; }
  askHeader(name) { return name.length + this.replyCode; }
  get isShut() { return this.replySent; }
}
const asking = {
  get status() { return this.inner.replyCode; },
  ask(name) { return this.inner.askHeader(name); },
};
const silent = { tag: 1 };
function wrap(inner) {
  const first = Object.create(asking);
  const second = Object.create(silent);
  first.inner = second.inner = inner;
  first.other = second;
  return first;
}
let sum = 0;
const emitter = new EventEmitter();
emitter.on("reply", inner => {
  const made = wrap(inner);
  sum += made.status + made.ask("abc") + made.other.inner.replyCode + made.other.tag;
});
for (let i = 0; i < 40; i++) emitter.emit("reply", new Reply(seed + i));
console.log(sum);
