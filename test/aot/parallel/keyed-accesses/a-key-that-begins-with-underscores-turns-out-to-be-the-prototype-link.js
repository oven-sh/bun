// `o["__" + rest] = v` with rest = "proto__" puts another object above `o`, and every later read of a name that `o` lacks finds it there. `o["on" + kind] = v` never does.
// Under: --aot-testing=CheckProofsAtRunTime: what stands above the objects of a layout
class Emitter { constructor() { this.onopen = null; } kind() { return "emitter"; } }
function listen(emitter, kind, f) { emitter["on" + kind] = f; }
function hide(o, rest, value) { o["__" + rest] = value; }
function kindOf(o) { return o.kind(); }
const parts = JSON.parse('["open","close","proto__","other__","__proto__"]');
const lines = [];
const emitter = new Emitter();
listen(emitter, parts[0], 1);
listen(emitter, parts[1], 2);
listen(emitter, parts[4], 3);
lines.push(Object.keys(emitter).join(), kindOf(emitter), Object.getPrototypeOf(emitter) === Emitter.prototype);
const hidden = new Emitter();
hide(hidden, parts[3], 4);
lines.push(Object.keys(hidden).join(), kindOf(hidden));
hide(hidden, parts[2], { kind() { return "moved"; } });
lines.push(Object.keys(hidden).join(), kindOf(hidden), hidden instanceof Emitter, kindOf(new Emitter()));
console.log(lines.join("\n"));
