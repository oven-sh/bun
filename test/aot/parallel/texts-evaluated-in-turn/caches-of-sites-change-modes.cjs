const { fullGC, edenGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
globalThis.collectYoung = () => void edenGC();
globalThis.compiledObject = i => ({ a: i % 2 ? undefined : {}, k: i, m() { return "compiled" + this.k; }, v: i / 2 });
globalThis.CompiledClass = class { a; k = 1; constructor(i) { this.k = i; if (i % 2) this.a = i; } m() { return "class" + this.k; } };
globalThis.compiledLate = i => { const o = { k: i }; if (i % 3) o.a = "late" + i; o.extra = o; return o; };
const text = `
const lines = [], show = v => typeof v === "function" ? "F" : v && typeof v === "object" ? (Array.isArray(v) ? "[" + v.map(show).join() + "]" : "O") : Object.is(v, -0) ? "-0" : String(v);
const attempt = f => { try { return show(f()); } catch (e) { return e.name; } };
const wide = (n, i) => { const o = { z: 1 }; for (let j = 0; j < n; j++) o["w" + j] = j; o.a = i; o.k = "wide" + i; return o; };
class Methods { constructor(i) { this.k = i; } a() { return "method"; } m() { return "m" + this.k; } get g() { return 1; } }
class Many { constructor(i) { this.k = i; } ${Array.from({ length: 24 }, (_, j) => `x${j}() { return ${j}; }`).join(" ")} a() { return "many"; } m() { return "far" + this.k; } }
class Grown { constructor(i) { this.g0 = i; this.g1 = i; this.g2 = i; this.g3 = i; this.g4 = i; this.g5 = i; this.g6 = -i; this.g7 = i; this.a = "grown" + i; } }
const up = { a: "up", m() { return "above"; } }, middle = Object.create(up);
const receivers = [i => ({ a: i }), i => ({ b: 1, c: 2, a: "third" + i }), i => wide(4, i), i => wide(9, i), i => wide(120, i), i => new Methods(i), i => new Many(i), i => new Grown(i), compiledObject, i => new CompiledClass(i), compiledLate,
    i => [i, 2], i => "text" + i, i => i, () => null, () => middle, i => Object.create(null), i => new Proxy({ a: i }, {}), i => JSON.parse('{"a":' + i + ',"k":[1]}'), i => ({ get a() { return "getter" + i; } }), i => new Uint8Array(i % 5), i => ({ __proto__: middle, own: i })];
const sites = [o => o.a, o => [o.k, o.a, o.k], o => o.m(), o => o.a === undefined ? "absent" : o.a, o => o.length, o => { o.k = "stored"; return o.k; }, o => { o.f1 = 1; o.f2 = "two"; o.f3 = o; return o.f1 + o.f2; }, o => typeof o.a === "function" ? o.a() : o.a];
for (let round = 0; round < 3; round++) {
    for (const site of sites) for (let first = 0; first < receivers.length; first++) for (const [r, n] of [[first, 3], [(first * 7 + round) % receivers.length, 45], [first, 20]]) {
        const kept = attempt(() => 1) && receivers[r](r);
        let last;
        for (let i = 0; i < n; i++) { const got = attempt(() => site(i % 3 ? kept : receivers[r](i))); if (got !== last) lines.push(got); last = got; }
    }
    if (round === 0) { up.a = "changed"; Methods.prototype.added = 1; middle.k = "middle"; Many.prototype.a = 5; collectYoung(); }
    if (round === 1) { delete up.a; Object.defineProperty(middle, "a", { get() { return "late getter"; }, configurable: true }); delete Methods.prototype.a; collect(); }
}
function scopes() {
    let one = 1; const two = "two"; var three = { in: 3 }; class Four {}
    return (function () { const five = [5]; return () => { lines.push(attempt(() => late) + attempt(() => late()) + attempt(() => { late = 1; })); const read = [one, two, three.in, five[0], typeof Four, Four === Four].join(); let late = read + one; return () => { one++; late += two; return late + one + five.length; }; }; })();
}
for (let i = 0; i < 4; i++) { const f = scopes()(); lines.push(f(), f()); }
${Array.from({ length: 42 }, (_, n) => `function frame${n}(${n % 3 ? "p, q" : ""}) { var ${Array.from({ length: n }, (_, j) => "v" + j).concat("end").join(", ")}; ${n % 4 ? "v0 = 1;" : ""} return [${Array.from({ length: n }, (_, j) => "v" + j).concat("end", n % 3 ? "p, q" : "0").join(", ")}].map(String).join(); }`).join("\n")}
for (let i = 0; i < 2; i++) lines.push(${Array.from({ length: 42 }, (_, n) => `frame${n}(1)`).join(", ")});
const callees = [x => x, function (x, y) { return [x, y, arguments.length]; }, (x, y = 2, ...z) => [x, y, z], Math.max, String, class {}, undefined, 5, (function () { "use strict"; return this; }), function () { return this === globalThis; }, (function (x) { return x; }).bind(null, "bound"), compiledLate];
const call = f => f(1), ignore = f => { f(1); return "ignored"; }, few = f => f(), many = f => f(1, 2, 3, 4);
for (let i = 0; i < 4; i++) for (const c of [call, ignore, few, many]) for (const f of callees) lines.push(attempt(() => c(f)));
const deep = n => n ? deep(n - 1) + 1 : 0;
lines.push(deep(800));
lines.length + " " + lines.reduce((h, l) => { l = String(l); for (let k = 0; k < l.length; k++) h = (Math.imul(h, 31) + l.charCodeAt(k)) | 0; return h; }, 0) + "\\n" + lines.slice(0, 1500).join("\\n");
`;
for (let t = 0; t < 2; t++) console.log((0, eval)("{" + text + "\n}//" + t));
// The VM of this worker has no compiled code, but runs the same interpreter.
const { Worker } = require("node:worker_threads");
const inWorker = text.replace(/\bcompiledObject\b|\bcompiledLate\b/g, "Object").replace(/new CompiledClass\(i\)/g, "new Plain(i)");
const worker = new Worker(`const { edenGC, fullGC } = require("bun:jsc"); globalThis.collect = () => void fullGC(); globalThis.collectYoung = () => void edenGC(); globalThis.Plain = class { constructor(i) { this.k = i; } }; const { parentPort } = require("node:worker_threads"); parentPort.postMessage([0, 1].map(t => { try { return (0, eval)("{" + ${JSON.stringify(inWorker)} + "\\n}//" + t); } catch (e) { return "THROWN " + e.message; } }));`, { eval: true });
worker.on("message", m => { console.log(m.join("\n")); worker.terminate(); });
worker.on("error", e => console.log("error", e.message));
