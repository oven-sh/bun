// Rest lists, literals and copies whose elements are known, spread into functions that are not known: emitters, methods, what is no function, changes of the list between, defaults, arguments, this.
const out = [], show = x => Array.isArray(x) ? "[" + x.length + ":" + x.map(show) + "]" : String(x);
const handlers = { };
const on = (name, f) => { (handlers[name] ??= []).push(f); };
const emit = (name, ...a) => { for (const f of handlers[name] || []) f(...a); };
let t = 0;
on("x", v => { t += v; }); on("y", (v, w) => { t -= w; }); on("y", function () { t += arguments.length; }); on("z", (...all) => { out.push(show(all)); });
for (let k = 0; k < 50; k++) { emit("x", k & 7); emit("y", 1, k & 3); if (k % 20 === 0) emit("z", k, "a", undefined); emit("none", 1); }
const more = [2, "m"]; function forward(...b) { emit("y", ...b); emit("z", 0, ...b); }
for (let k = 0; k < 20; k++) { forward(k, 1); forward(...more); emit("z", k, ...more); if (k === 9) more.push(k); }
out.push(t);
function changed(f, ...a) { const r = [f(...a)]; a.push(9); r.push(f(...a)); a[0] = "z"; r.push(f(...a)); a.length = 1; r.push(f(...a)); return r; }
for (const f of [(...x) => x.length, (a, b = 5) => a + ":" + b, function () { return arguments.length + typeof this; }, Math.max, String]) out.push(show(changed(f, 1, 2)), show(changed(f)), show(changed(f, ...[4, 5, 6])));
function copies(f, a, b) { const l = [a, b]; const m = [...l, 3]; return [f(...l), f(...m), f(0, ...l), f(...l, ...m)]; }
for (const f of [(...x) => x.join("."), function (a, b, c, d, e) { return e; }]) out.push(show(copies(f, 1, "q")));
const o = { tag: "o", m(...x) { return this.tag + x; } };
function method(o, ...a) { return o.m(...a) + o["m"](...a, 1); }
out.push(method(o, 1, 2), method({ tag: "p", m: o.m }));
for (const f of [null, undefined, 3, {}]) { try { ((g, ...a) => g(...a))(f, 1); } catch (e) { out.push(e.constructor.name); } try { emit.call(null, ...[f]); } catch (e) { out.push(e.constructor.name); } }
console.log(out.join(" "));
