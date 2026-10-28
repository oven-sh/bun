// 121 classes, one below another in many ways, are constructed in rotation with collections between; then the prototypes get a method, a setter, are frozen.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
class Base { a = 1; f = 1.5; constructor(x) { this.x = x; } }
const below = (parent, i) => i % 4 === 0 ? class extends parent { } : i % 4 === 1 ? class extends parent { p = i; } : i % 4 === 2 ? class extends parent { p = i; q = "q"; r = null; s = 0.25; t = [i]; u; v = i; w = i; } : class extends parent { a = "other"; constructor(x) { super(x); this.late = x; } };
const classes = [Base];
for (let i = 0; i < 120; i++) classes.push(below(classes[i % 5 ? (i * 7) % classes.length : 0], i));
let sum = 0;
for (let turn = 0; turn < 6000; turn++) {
  const C = classes[(turn * 13 + (turn >> 5)) % classes.length];
  const made = new C(turn);
  if (Object.getPrototypeOf(made) !== C.prototype || made.x !== turn) lines.push("another prototype at " + turn);
  sum += Object.keys(made).length;
  if (turn % 1500 === 749 && typeof Bun !== "undefined") Bun.gc(true);
}
lines.push(String(sum));
for (const i of [0, 1, 2, 3, 4, 50, 119, 120]) say("class " + i, new classes[i](i));
Base.prototype.added = function () { return Object.keys(this).length; };
lines.push(String(new classes[7](1).added()));
Object.defineProperty(Base.prototype, "x", { set(v) { lines.length < 60 && lines.push("setter " + v); }, configurable: true });
say("behind a setter for x", new classes[3](5)); say("Base behind it", new Base(6));
delete Base.prototype.x;
Object.freeze(classes[2].prototype); say("frozen prototype", new classes[2](7));
Object.preventExtensions(classes[3]); say("class not extensible", new classes[3](8));
const kept = []; for (let i = 0; i < 40000; i++) { const made = new classes[1 + (i % 9)](i); if (!(i % 8000)) kept.push(made); }
for (const made of kept) say("kept", made);
console.log(lines.join("\n"));
