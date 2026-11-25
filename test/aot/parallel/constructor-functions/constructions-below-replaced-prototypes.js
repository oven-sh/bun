// Constructions in loops, in functions that call themselves and outside of both, around replacements of the constructor's prototype.
const lines = [];
function show(v, d = 0) { if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v); if (v === null || typeof v !== "object") return typeof v === "function" ? "fn" : typeof v === "string" ? JSON.stringify(v) : String(v); if (d > 2) return ".."; if (Array.isArray(v)) return "[" + v.map(x => show(x, d + 1)).join() + "]"; const p = Object.getPrototypeOf(v); return (p === null ? "null:" : p === Object.prototype ? "" : protos.has(p) ? protos.get(p) + ":" : "?:") + "{" + Object.keys(v).map(k => k + "=" + show(v[k], d + 1)).join() + "}"; }
const protos = new Map();
function say(...a) { if (lines.length < 300) lines.push(a.map(x => show(x)).join(" ")); }
function attempt(f) { try { return f(); } catch (e) { say("throws", e instanceof Error ? e.constructor.name : e); } }
function done() { let h = 0; for (const l of lines) for (let i = 0; i < l.length; i++) h = (h * 31 + l.charCodeAt(i)) | 0; console.log(lines.slice(0, 70).join("\n")); console.log(lines.length, h); }
function F0(x, y) { this.c = x + 0.5; this.next = x; this["b"] = 0; this.d = y; }
F0.prototype.sum = function () { return 1; };
const kept = []; function deep(x) { return x > 2 ? { deep: x } : x; }
const P = [F0.prototype]; P.forEach((p, i) => { if (p && typeof p === "object") protos.set(p, "P" + i); }); const others = [{ o: 1 }, null, Object.create(null), 5, undefined, function () {}, Array.prototype]; others.forEach((p, i) => { if (p && typeof p === "object") protos.set(p, "O" + i); });
function loop(n, at) { const list = []; let o = null; for (let i = 0; i < n; i++) { if (i === at) attempt(() => { if (P[0] && typeof P[0] === "object") P[0].late = 3; }); o = new F0(i); list.push(o); const q = new (F0)(i, null, 1); list.push(q); } return list; }
function tree(d) { return d <= 0 ? new (F0)(d, null, 1) : new F0(tree(d - 1), tree(d - 2)); }
var walk = function (d) { if (d === 0) return null; return new F0(d, walk(d - 1)); };
function once(x) { const i = x, o = null; const p = new F0(i); return p; }
function dropped(n) { let s = 0; for (let i = 0; i < n; i++) { const v = new F0(i, i + 1); s += v && typeof v.a === "number" ? v.a : 1; } return s; }
function early(n) {}
say("dropped", attempt(() => dropped(6)));
say("tree", attempt(() => tree(3)));
say("loop with event", attempt(() => loop(7, 0)));
attempt(() => { Object.assign(F0, { prototype: others[0] }); });
say("once", attempt(() => once(2)));
if (typeof gc === "function") gc();
early(300);
say("instance", attempt(() => new F0(1) instanceof F0), attempt(() => new F0(1, 2) instanceof F0));
say("walk", attempt(() => walk(4)));
attempt(() => { Reflect.set(F0, "prototype", others[0]); });
say("loop", attempt(() => loop(7, -1)));
say("again", attempt(() => loop(5, -1)), attempt(() => tree(2)), attempt(() => walk(3)), attempt(() => once(1)), attempt(() => dropped(5)));
say("kept", kept.length);
done();
