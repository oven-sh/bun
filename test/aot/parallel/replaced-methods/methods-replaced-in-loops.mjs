// Methods on prototypes that stores replace again and again, as spies in tests do: every read finds what was stored last, behind every other change of the chain too.
class Greeter { constructor(name) { this.name = name; } greet() { return "hi " + this.name; } leave() { return "bye " + this.name; } both() { return this.greet() + "," + this.leave(); } }
class Loud extends Greeter { both() { return super.both() + "!"; } }
class Own extends Greeter { greet() { return "own " + super.greet(); } }
const greet = Greeter.prototype.greet, leave = Greeter.prototype.leave, hey = function () { return "hey " + this.name; }, spied = [];
const spy = (object, name) => { const held = object[name]; object[name] = function (...rest) { spied.push(name); return held.apply(this, rest); }; return () => { object[name] = held; }; };
const a = new Greeter("a"), b = new Loud("b"), c = new Own("c"), lines = [];
let junk;
for (let i = 0; i < 400; i++) {
  Greeter.prototype.greet = hey; let line = a.greet() + b.greet() + c.greet();
  Greeter.prototype.greet = greet; line += a.greet() + b.both();
  Greeter.prototype.leave = i & 1 ? leave : () => "gone"; line += a.leave() + b.both() + c.both();
  const restore = spy(Greeter.prototype, "greet"); line += a.greet() + c.both(); restore(); line += a.greet();
  if (i % 50 === 7) { Greeter.prototype.greet = 5; try { line += a.greet(); } catch (error) { line += error.name; } Greeter.prototype.greet = greet; }
  if (i % 50 === 11) { Object.defineProperty(Greeter.prototype, "greet", { get() { return hey; }, configurable: true }); line += a.greet() + b.both(); Object.defineProperty(Greeter.prototype, "greet", { value: greet, writable: true, configurable: true }); line += a.greet(); }
  if (i % 50 === 13) { delete Greeter.prototype.leave; try { line += b.both(); } catch (error) { line += error.name; } Greeter.prototype.leave = leave; line += b.both(); }
  if (i % 50 === 17) { Loud.prototype.greet = hey; line += b.greet() + a.greet(); delete Loud.prototype.greet; line += b.greet(); }
  if (i % 50 === 19) { b.greet = () => "instance"; line += b.both(); Greeter.prototype.greet = hey; line += b.both() + a.greet(); delete b.greet; line += b.greet(); Greeter.prototype.greet = greet; }
  if (i % 50 === 23) { class Late extends Greeter { greet() { return "late " + super.greet(); } } line += new Late("l").both(); Greeter.prototype.greet = hey; line += new Late("m").greet(); Greeter.prototype.greet = greet; }
  if (i > 300) { Object.defineProperty(Greeter.prototype, "leave", { writable: false }); try { Greeter.prototype.leave = () => "never"; } catch (error) { line += error.name; } line += a.leave(); Object.defineProperty(Greeter.prototype, "leave", { writable: true }); }
  if (i % 90 === 0) for (let k = 0; k < 20000; k++) junk = [k, junk && k];
  lines.push(line);
}
let hash = 0; for (const line of lines) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(lines.length, hash, spied.length, lines[0], lines[7], lines.at(-1));
