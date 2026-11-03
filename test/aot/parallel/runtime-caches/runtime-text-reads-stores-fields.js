// Run time text reads and stores fields of compiled objects at sites that remember.
"use strict";
// Text that nobody knows at the build runs in the interpreter, whose accesses by name remember what they saw last. Here they see fields of compiled objects that come, go and change their form.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
const text = (parameters, body) => new Function(...parameters, body + unknown);
const lines = [];
const say = (...values) => lines.push(values.map(value => typeof value === "string" ? value : Object.is(value, -0) ? "-0" : typeof value === "symbol" || typeof value === "bigint" ? String(value) : JSON.stringify(value) ?? String(value)).join(" "));

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
class Holder {
  constructor(value) {
    this.value = value;
  }
  late() {
    this.added = "late";
  }
}
class Below extends Holder {}
function Old(value) {
  this.value = value;
}
Old.prototype.shared = "from the prototype";

const readValue = text(["o"], "return o.value;");
const readAdded = text(["o"], "return o.added;");
const readX = text(["o"], "return o.x;");
const readShared = text(["o"], "return o.shared;");
const hasValue = text(["o"], "return 'value' in o;");
const hasAdded = text(["o"], "return 'added' in o;");
const storeValue = text(["o", "v"], "o.value = v; return o;");

// Every kind of value at one site.
for (const value of [1, -0, 1.5, NaN, "text", "", true, false, null, undefined, { a: 1 }, [1, 2], 10n, Symbol.for("s"), () => 1]) {
  const holder = new Holder(value);
  for (let i = 0; i < 3; i++) say("value", typeof readValue(holder), typeof value === "function" ? "function" : readValue(holder));
}

// A field that goes and comes back, in every way.
{
  const holder = new Holder("first");
  for (let i = 0; i < 4; i++) readValue(holder);
  say(readValue(holder), hasValue(holder));
  delete holder.value;
  say(readValue(holder), hasValue(holder));
  Holder.prototype.value = "inherited";
  say(readValue(holder), hasValue(holder), readValue(new Holder("own")));
  delete Holder.prototype.value;
  say(readValue(holder), hasValue(holder));
  holder.value = "again";
  say(readValue(holder), hasValue(holder), Object.keys(holder).join());
  let calls = 0;
  Object.defineProperty(holder, "value", { get() { return "getter " + ++calls; }, configurable: true, enumerable: true });
  say(readValue(holder), readValue(holder), hasValue(holder));
  Object.defineProperty(holder, "value", { value: "data again", writable: true, configurable: true, enumerable: true });
  say(readValue(holder), readValue(new Holder("other")));
}

// A field that is created late.
{
  const holder = new Holder(0);
  for (let i = 0; i < 4; i++) say(readAdded(holder), hasAdded(holder));
  holder.late();
  for (let i = 0; i < 4; i++) say(readAdded(holder), hasAdded(holder));
  say(readAdded(new Holder(1)), hasAdded(new Holder(1)));
}

// One site, many kinds of receivers, in turns.
{
  const receivers = [new Holder("holder"), new Below("below"), new Old("old"), { value: "literal" }, { other: 1, value: "second literal" }, Object.create({ value: "above" }), Object.assign(new Holder("with more"), { ["m" + unknown]: 1 }), "string", 5, [], new Map()];
  for (let round = 0; round < 4; round++) {
    for (const receiver of receivers) say(round, readValue(receiver), typeof receiver === "object" ? hasValue(receiver) : "-");
  }
  for (const nothing of [null, undefined]) {
    try {
      readValue(nothing);
    } catch (error) {
      say(error.constructor.name);
    }
  }
}

// Fields that hold raw numbers, and a method and a value of the prototype.
{
  const points = [new Point(1, 2), new Point(1.5, 2), new Point(-0, 0), new Point(2 ** 31, 0), new Point(NaN, 0)];
  for (let round = 0; round < 3; round++) for (const point of points) say(readX(point));
  for (let round = 0; round < 4; round++) say(readShared(new Old(round)));
  Old.prototype.shared = "changed";
  say(readShared(new Old(0)));
  const own = new Old(1);
  own.shared = "own";
  say(readShared(own), readShared(new Old(2)));
}

// Stores.
{
  const holder = new Holder("start");
  for (const value of ["a", 1, null, undefined, { b: 1 }, 1.5, true]) say(storeValue(holder, value).value, readValue(holder));
  const frozen = Object.freeze(new Holder("frozen"));
  try {
    text(["o"], "'use strict'; o.value = 1;")(frozen);
  } catch (error) {
    say(error.constructor.name, frozen.value);
  }
  storeValue(frozen, 2);
  say(frozen.value);
  const emptied = new Holder("x");
  delete emptied.value;
  say(storeValue(emptied, "created by text").value, Object.keys(emptied).join());
}

// Structures that die while sites remember them.
{
  let sum = 0;
  for (let round = 0; round < 40; round++) {
    const reader = text(["o"], "return o.value;");
    for (let i = 0; i < 30; i++) {
      const holder = new Holder(i);
      holder["extra" + round + "_" + (i & 3) + unknown] = i;
      sum += reader(holder) + readValue(holder);
    }
    if (round % 8 === 7) Bun.gc(true);
  }
  say("sum", sum);
}

// Properties that text adds to its own objects below prototypes that change.
{
  const top = { marker: "top" };
  const middle = Object.create(top);
  const make = text(["proto"], "const o = Object.create(proto); o.k = 1; o.l = 2; return o;");
  const plain = text([], "const o = {}; o.k = 1; o.l = 2; return o;");
  for (let i = 0; i < 5; i++) say(Object.keys(make(middle)).join(), Object.keys(plain()).join());
  const seen = [];
  Object.defineProperty(top, "l", { set(value) { seen.push("top " + value); }, configurable: true });
  say(Object.keys(make(middle)).join(), seen.join());
  Object.defineProperty(middle, "k", { set(value) { seen.push("middle " + value); }, configurable: true });
  say(Object.keys(make(middle)).join(), seen.join(), Object.keys(plain()).join());
  delete top.l;
  delete middle.k;
  say(Object.keys(make(middle)).join(), seen.join());
  Object.defineProperty(top, "k", { value: "read only", writable: false, configurable: true });
  say(Object.keys(make(middle)).join(), make(middle).k);
}

// Empty array literals of text, whose sites learn what the arrays come to hold.
{
  const fresh = text(["v", "n"], "const a = []; for (let i = 0; i < n; i++) a.push(v); return a;");
  for (const value of [1, 1.5, "s", undefined, { o: 1 }, 2, 2.5]) {
    for (const n of [0, 1, 4, 5, 6, 9]) {
      const array = fresh(value, n);
      say(array.length, 0 in array, n in array, array[n], array[5], JSON.stringify(array));
    }
  }
  const sparse = text([], "const a = []; a[3] = 1.5; return a;");
  for (let i = 0; i < 4; i++) say(JSON.stringify(sparse()), Object.keys(sparse()).join(), 1 in sparse());
  const filled = text(["a", "b", "c"], "return [[a], [a, b], [a, b, c], [a, b, c, a, b, c, a]];");
  for (const [a, b, c] of [[1, 2, 3], [1.5, 2, 3], ["x", 2, null], [undefined, undefined, undefined]]) say(JSON.stringify(filled(a, b, c)));
}

console.log(lines.length);
console.log(lines.join("\n"));
