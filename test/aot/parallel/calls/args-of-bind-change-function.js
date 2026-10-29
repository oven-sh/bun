// `f.bind(thisValue, argument)`: `bind` is looked up first, then the arguments are evaluated, then the bound function takes the name, the length and the prototype that f has AT THAT MOMENT.
// A compiler that has tested "f is as it was created" where it looked `bind` up knows nothing any more once an argument has run. Text nobody has seen is handed the functions, so only a test can say so.
const unseen = Function("f", process.argv[9] ?? "return f");
function joins(a, b) { return [typeof this, a, b].join(); }
function adds(a, b, c) { return a + b + c; }
function plain(a) { return a; }
unseen(joins); unseen(adds); unseen(plain);
const lines = [];
function renames(f, name) { Object.defineProperty(f, "name", { value: name, configurable: true }); return 1; }
function resizes(f, length) { Object.defineProperty(f, "length", { value: length, configurable: true }); return 2; }
const otherPrototype = Object.create(Function.prototype, { marked: { value: "marked" } });
function reparents(f, prototype) { Object.setPrototypeOf(f, prototype); return 3; }
function shadows(f, on) { if (on) f.bind = function () { return () => "own bind"; }; else delete f.bind; return 4; }
let text = "";
for (let i = 0; i < 400; i++) {
  const untouched = plain.bind(null, i);
  const renamed = joins.bind(null, renames(joins, "n" + (i & 3)));
  const resized = adds.bind(null, resizes(adds, i & 7));
  if (i % 100 === 99) text += [untouched.name, untouched.length, untouched(), renamed.name, renamed.length, renamed(5), resized.name, resized.length, resized(1, 1)].join(" ") + "|";
}
lines.push(text);
function late(a) { return a * 2; }
unseen(late);
text = "";
for (let i = 0; i < 300; i++) {
  const bound = late.bind(null, reparents(late, i & 1 ? otherPrototype : Function.prototype));
  if (i % 75 === 74 || i % 75 === 73) text += [bound.marked, Object.getPrototypeOf(bound) === otherPrototype, bound()].join(" ") + "|";
}
lines.push(text);
function hidden(a) { return a + 1; }
unseen(hidden);
text = "";
for (let i = 0; i < 300; i++) {
  const first = hidden.bind(null, shadows(hidden, (i & 3) === 3));
  const second = hidden.bind(null, 10);
  if (i % 60 > 56) text += [first(), second(), Object.hasOwn(hidden, "bind")].join(" ") + "|";
  shadows(hidden, false);
}
lines.push(text);
console.log(lines.join("\n"));
