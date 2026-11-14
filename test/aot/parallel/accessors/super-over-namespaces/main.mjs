// `super.name` in a method of an object literal whose prototype is the namespace of a module, in loops whose guesses fail.
// STATISTIC: SuperReadsAskingTables >= 4
import * as whole from "./values.mjs";
import { change, fill } from "./values.mjs";
const child = {
  __proto__: whole,
  all() { return super.count + super.text.length; },
  hi(x) { return super.hi(x) * 2; },
  none() { return super.none; },
  late() { return super.late; },
  loop(n) { let s = 0; for (let i = 0; i < n; i++) { s += super.count; change(); } return s; },
  twice(n) { let s = 0; for (let i = 0; i < n; i++) { const a = super.count; change(); s += a * 1000 + super.count; } return s; },
  set(n) { try { super.count = n; return "stored"; } catch (error) { return error.constructor.name; } },
};
const attempt = f => { try { return String(f()); } catch (error) { return error.constructor.name; } };
const run = (o, n) => { let s = 0; for (let i = 0; i < n; i++) s += o.all(); return s; };
const runHi = (o, n) => { let s = 0; for (let i = 0; i < n; i++) s += o.hi(i & 3); return s; };
const place = new Function("target", "prototype", "Object.setPrototypeOf(target, prototype)");
const tell = () => console.log(attempt(() => run(child, 0)), attempt(() => run(child, 1)), attempt(() => run(child, 300)), attempt(() => runHi(child, 40)), attempt(() => child.loop(20)), attempt(() => child.twice(20)), attempt(() => child.none()), attempt(() => child.late()), attempt(() => child.default));
tell();
for (const value of [1, "two", undefined, null, 1.5, { toString: () => "three" }]) {
  fill(value);
  let s = "";
  for (let i = 0; i < 20; i++) s += String(child.late()).length;
  console.log(s, attempt(() => child.late()));
}
console.log(child.set(3)); tell();
place(child, { count: 1, text: "xy", hi(x) { return this === child ? x : -x; }, late: 7 }); tell();
place(child, { get count() { return this === child ? 10 : 20; }, get text() { return this === child ? "abc" : ""; }, hi: 5 }); tell();
place(child, whole); tell();
place(child, null); tell();
place(child, new Proxy(whole, { get(target, name, receiver) { return name === "hi" ? x => x + (receiver === child ? 9 : 10) : target[name]; } })); tell();
place(child, { __proto__: whole }); tell();
place(child, await import("./values.mjs")); tell();
let changes = 0; place(child, { get count() { if (++changes === 5) place(child, whole); return 1; }, text: "t", hi(x) { return x; } }); tell();
class Above {}
class Below extends Above { count() { return super.count; } all() { return super.count + super.text.length; } hi(x) { return super.hi(x); } }
const below = new Below();
console.log(attempt(() => run(below, 3)), attempt(() => runHi(below, 3)), below.count());
place(Below.prototype, whole);
console.log(attempt(() => run(below, 300)), attempt(() => runHi(below, 30)), below.count());
let s = 0; for (let i = 0; i < 20; i++) { s += below.count(); change(); } console.log(s);
