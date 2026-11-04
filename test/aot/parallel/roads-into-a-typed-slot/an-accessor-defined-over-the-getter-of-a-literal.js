// a literal lays a getter; another function of the program is defined over it, in line, on one object of the layout: whoever reads calls what lies there
function make(k) { return { raw: k, get value() { return "own" + this.raw; }, set value(v) { this.raw = v; } }; }
function other() { return "other" + this.raw; }
function otherSetter(v) { this.raw = "set" + v; }
function read(o) { return o.value; }
function write(o, v) { o.value = v; return o.raw; }
const all = []; for (let k = 0; k < 6; k++) all.push(make(k));
Object.defineProperty(all[1], "value", { get: other, configurable: true, enumerable: true });
Object.defineProperty(all[2], "value", { get: other, set: otherSetter, configurable: true, enumerable: true });
Object.defineProperty(all[3], "value", { set: otherSetter });
Object.defineProperty(all[4], "value", { get: () => "arrow" });
Object.defineProperty(all[5], "value", { get: Math.random.bind(null).name.constructor.bind(null, "bound") });
const out = []; for (let round = 0; round < 3; round++) for (const o of all) out.push(String(read(o)), String(write(o, round)), String(read(o)));
console.log(out.join(" "));
