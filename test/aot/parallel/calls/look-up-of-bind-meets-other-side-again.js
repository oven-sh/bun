// `f.bind(..)` where the look-up of `bind` and the call are apart: whatever the look-up has found out about f, the arguments run in between, and both sides of its test meet again in front of the call.
const unseen = Function("f", process.argv[9] ?? "return f");
function joins(a, b, c) { return [a, b, c].join(); }
function counts(a, b) { return a + b; }
unseen(joins); unseen(counts);
let text = "";
let touched = 0;
function pick(i) { return i % 3 === 0 ? joins : counts; }
for (let i = 0; i < 3000; i++) {
  const f = pick(i);
  const method = f.bind;
  const bound = i & 1 ? method.call(f, null, i) : f.bind(null, i & 7, (touched += 1, 2));
  if (i === 1500) { Object.defineProperty(joins, "name", { value: "renamed", configurable: true }); counts.extra = 1; }
  if (i === 2200) { delete counts.extra; Object.defineProperty(counts, "length", { value: 9, configurable: true }); }
  if (i % 500 < 4) text += [bound.name, bound.length, bound(1, 2), Object.hasOwn(bound, "prototype"), typeof bound].join(" ") + "|";
}
console.log(text, touched);
class Base { constructor(a) { this.a = a; } }
function Plain(a, b) { this.sum = a + b; }
unseen(Plain); unseen(Base);
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const Bound = Plain.bind(null, i);
  const made = new Bound(1);
  sum += made.sum + (made instanceof Plain ? 1 : 0) + (made instanceof Bound ? 1 : 0) + (Object.getPrototypeOf(made) === Plain.prototype ? 1 : 0);
  if (i === 1000) Plain.prototype = { marked: true };
}
let threw = "";
try { class Heir extends Plain.bind(null, 1) {} threw = "no"; } catch (error) { threw = error.constructor.name; }
console.log(sum, threw, new (Plain.bind(null, 1))(2).marked);
