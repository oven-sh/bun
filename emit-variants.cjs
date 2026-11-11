// Userland copies of the own emit on a release build of main: which shape is cheapest?
const { spawn } = require("node:child_process");
const EventEmitter = require("node:events");
const V = process.env.V || "apply";
const c = spawn("sleep", ["30"], { stdio: ["ignore", "pipe", "ignore"] });
const s = c.stdout;
const kEmit = Symbol("emit"), kEmitsNothing = Symbol("emitsNothing");
s[kEmit] = undefined; s[kEmitsNothing] = false;
const variants = {
  apply: function emitOfHandle(event) {
    if (this[kEmitsNothing]) return false;
    const emit = this[kEmit] ?? EventEmitter.prototype.emit;
    if (event !== "data") return emit.apply(this, arguments);
    try { return emit.apply(this, arguments); } catch (e) { this[kEmitsNothing] = true; return true; }
  },
  call: function emitOfHandle(event, chunk) {
    if (this[kEmitsNothing]) return false;
    const emit = this[kEmit] ?? EventEmitter.prototype.emit;
    if (event !== "data" || arguments.length !== 2) return emitRest.apply(this, arguments);
    try { return emit.call(this, "data", chunk); } catch (e) { this[kEmitsNothing] = true; return true; }
  },
  captured: (() => { const emit = EventEmitter.prototype.emit; return function emitOfHandle(event, chunk) {
    if (this[kEmitsNothing]) return false;
    if (event !== "data" || arguments.length !== 2) return emit.apply(this, arguments);
    try { return emit.call(this, "data", chunk); } catch (e) { this[kEmitsNothing] = true; return true; }
  }; })(),
};
function emitRest() { const emit = this[kEmit] ?? EventEmitter.prototype.emit; return emit.apply(this, arguments); }
if (V !== "none") Object.defineProperty(s, "emit", { value: variants[V], writable: true, configurable: true });
let n = 0;
s.on("data", chunk => { n += chunk.length; });
s.pause();
const chunk = Buffer.alloc(16), N = 5e6, rounds = [];
for (let r = 0; r < 7; r++) {
  for (let i = 0; i < 2e5; i++) s.emit("data", chunk);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) s.emit("data", chunk);
  rounds.push(Number(process.hrtime.bigint() - t0) / N);
}
console.log(V.padEnd(9) + " ns/emit: " + rounds.map(v => v.toFixed(1)).join(" ") + " | min " + Math.min(...rounds).toFixed(1));
c.kill();
