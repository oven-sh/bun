// Whoever holds the functions of a promise that Promise.race or Promise.all made may call them behind its settlement; nothing changes then.
{
const out = [];
const own = Promise.resolve("own");
own.then = function (f, r) { out.push("own then"); return Promise.prototype.then.call(this, f, r); };
const show = v => typeof v === "object" ? JSON.stringify(v) : String(v);
async function one(name, f) { let v; try { v = show(await f()); } catch (e) { v = "!" + show(e); } out.push(name + " " + v); }
await one("a", () => Promise.race([Promise.resolve({ a: 1 }), own]));
await one("b", () => Promise.race([Promise.resolve({ a: 1 }), Promise.resolve(NaN), -0, own]));
{ const a = Promise.allSettled([own]), b = Promise.race([Promise.resolve({ a: 1 }), Promise.resolve(NaN), -0, own]); await one("c", () => a); await one("d", () => b); }
{ const a = Promise.allSettled([own]), b = Promise.race([Promise.resolve({ a: 1 }), own]); await one("e", () => a); await one("f", () => b); }
{ const a = Promise.allSettled([own]), b = Promise.race([Promise.resolve({ a: 1 }), Promise.resolve(2)]); await one("g", () => a); await one("h", () => b); }
{ const a = own.then(x => x), b = Promise.race([Promise.resolve({ a: 1 }), own]); await one("i", () => a); await one("j", () => b); }
{ const b = Promise.race([Promise.resolve({ a: 1 }), own]); await 0; await one("k", () => b); }
{ const b = Promise.race([own, Promise.resolve({ a: 1 })]); await 0; await one("l", () => b); }
for (const line of out) console.log(line);
}
{
const out = [];
const show = v => v instanceof Error ? "!" + v.message : JSON.stringify(v);
async function settled(name, p) { try { out.push(name + " " + show(await p)); } catch (e) { out.push(name + " threw " + show(e)); } }
const turns = async n => { for (let i = 0; i < n; i++) await 0; };
function own(call) { const kept = {}; const p = Promise.resolve("own"); p.then = function (f, r) { kept.f = f; kept.r = r; if (call) f("by own then"); }; return [p, kept]; }
for (const kind of ["f", "r"]) {
  for (const waits of [0, 1, 2, 3, 6]) {
    { const [t, kept] = own(true); let done; const last = new Promise(x => { done = x; }); const p = Promise.all([t, last]); const q = waits & 1 ? p.then(x => x) : null; done("last"); await turns(waits); await turns(4); kept[kind](new Error("late")); await settled("all " + kind + waits, p); if (q) await settled("all then " + kind + waits, q); await settled("all again " + kind + waits, p); }
    { const [t, kept] = own(false); const p = Promise.race([Promise.resolve({ a: 1 }), t]); await turns(waits); kept[kind](kind === "f" ? "late" : new Error("late")); await settled("race " + kind + waits, p); await settled("race again " + kind + waits, p); }
    { const [t, kept] = own(false); const p = Promise.race([Promise.resolve(7), t]); const q = p.then(x => "q" + x); await turns(waits); kept[kind](kind === "f" ? Promise.resolve("late") : "late"); await settled("race then " + kind + waits, q); await turns(5); await settled("race then again " + kind + waits, p); }
    { const [t, kept] = own(false); const p = Promise.race([t, Promise.resolve(8)]); await turns(waits); kept[kind](kind === "f" ? { then(f) { f("late"); } } : "late"); await turns(waits); await settled("race first " + kind + waits, p); }
    { const [t, kept] = own(false); const p = Promise.any([Promise.resolve(9), t]); await turns(waits); kept[kind](kind === "f" ? "late" : new Error("late")); await settled("any " + kind + waits, p); }
    { const [t, kept] = own(true); const p = Promise.allSettled([Promise.resolve(9), t]); await turns(waits); kept[kind]("late"); await settled("allSettled " + kind + waits, p); }
    { const [t, kept] = own(false); const p = Promise.resolve().then(() => t); await turns(waits); await turns(3); kept[kind]("first"); kept.f("second"); kept.r("third"); await settled("followed " + kind + waits, p); }
  }
}
for (const line of out) console.log(line);
}
