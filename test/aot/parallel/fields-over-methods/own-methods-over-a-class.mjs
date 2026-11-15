// STATISTIC: MethodsReadUnderEmptyFields >= 4
// Env: BUN_JSC_slowPathAllocsBetweenGCs=5
// Objects that get an own method over their class's in the body that constructs them: every read finds the method in front of the store and the own one behind it.
class Greeter { constructor(name) { this.name = name; } greet() { return "hi " + this.name; } both() { return this.greet() + "!"; } }
class Named { constructor(name) { this.name = name; seen = this; } label(a) { return this.name + (a | 0); } ask() { return this.label(2); } }
class Parent { constructor(n) { this.n = n; } size() { return this.n; } twice() { return this.size() * 2; } }
class Child extends Parent { size() { return super.size() + 1; } }
class Frozen { constructor(n) { this.n = n; } read() { return this.n; } }
class Replaced { constructor(n) { this.n = n; } run() { return "class" + this.n; } }
let seen, total = 0;
const lines = [], add = text => { for (let q = 0; q < text.length; q++) total = (Math.imul(total, 31) + text.charCodeAt(q)) | 0; };
const shared = function () { return "shared " + this.name; };
for (let i = 0; i < 3000; i++) {
  const a = new Greeter("x" + (i & 3));
  let out = a.greet();
  a.greet = () => "own";
  out += a.greet() + a.both() + Object.keys(a).join();
  if (i % 3 === 0) { a.greet = shared; out += a.greet() + a.both(); }
  if (i % 5 === 0) { delete a.greet; out += a.greet() + a.both() + Object.keys(a).join(); }
  add(out);
  if (i === 2999) lines.push(out);
}
for (let i = 0; i < 2000; i++) {
  const b = new Named("n" + (i & 1));
  let out = b.label(1) + seen.label(3) + typeof b.label + ("label" in b) + b.hasOwnProperty("label");
  if (i & 1) b.label = a => "own" + a;
  out += b.label(1) + seen.label(3) + b.ask() + b.hasOwnProperty("label") + JSON.stringify(b);
  for (const name in b) out += name;
  add(out);
  if (i > 1997) lines.push(out);
}
for (let i = 0; i < 2000; i++) {
  const c = i & 1 ? new Parent(i & 7) : new Child(i & 7);
  let out = String(c.size()) + c.twice();
  if (i % 3) c.size = () => 40;
  out += String(c.size()) + c.twice() + { ...c }.size?.();
  add(out);
  if (i > 1997) lines.push(out);
}
for (let i = 0; i < 2000; i++) {
  const d = new Frozen(i & 3);
  if (i % 4 === 1) Object.freeze(d);
  if (i % 4 === 2) Object.preventExtensions(d);
  let out = String(d.read());
  try { d.read = () => "own"; } catch (error) { out += error.name; }
  out += d.read();
  if (i === 1500) Object.freeze(Frozen.prototype);
  add(out);
  if (i > 1996) lines.push(out);
}
for (let i = 0; i < 2000; i++) {
  const e = new Replaced(i & 3);
  let out = e.run();
  try { if (i % 3 === 0) e.run = () => "own"; } catch (error) { out += error.name; }
  out += e.run();
  if (i === 1200) Replaced.prototype.run = function () { return "stored" + this.n; };
  if (i === 1500) Object.defineProperty(Replaced.prototype, "run", { get() { return () => "getter"; }, set(value) { total++; }, configurable: true });
  if (i === 1800) Object.defineProperty(Replaced.prototype, "run", { value: () => "fixed", writable: false, configurable: true });
  try { if (i > 1810) e.run = () => "late"; } catch (error) { out += error.name; }
  add(out + e.run());
  if (i === 1199 || i === 1201 || i === 1503 || i > 1997) lines.push(out + e.run());
}
console.log(total, lines.join(" | "));
