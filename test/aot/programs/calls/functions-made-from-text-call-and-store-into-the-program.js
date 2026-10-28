// Functions made from text that run often: they call functions of the program, store into its objects, await, switch and write closure variables.
class Payload {
  constructor(value) {
    this.value = value;
    this.issues = [];
  }
}
const double = n => n * 2;
const negate = n => -n;
const describe = function (n) {
  return this === undefined ? "no this " + n : this.name + " " + n;
};
const lines = [];

const store = new Function("payload", "result", "payload.value = result; return payload;");
const call = new Function("holder", "n", "return holder.run(n);");
const pick = new Function("n", "switch (n) { case 0: return 'zero'; case 1: return 'one'; case 3: return 'three'; default: return 'other'; }");
const makeCounter = new Function("let count = 0; return function (n) { count = count + n; return count; };");
const wait = new Function("values", "return (async function () { let total = 0; for (const value of values) total += await value; return total; })();");
const build = new Function("a", "b", "const made = {}; made.a = a; made.b = b; const pair = { a, list: [] }; pair.list.push(b); return [made, pair];");

const counter = makeCounter();
const holder = { name: "holder", run: double };
let sum = 0;
for (let i = 0; i < 400; i++) {
  const payload = new Payload(i);
  sum += store(payload, { n: i }).value.n;
  sum += call(holder, i);
  sum += counter(i % 3);
  sum += pick(i % 5).length + pick(i / 2).length + pick("1").length;
  const [made, pair] = build(i, "b");
  sum += made.a + pair.list.length + Object.keys(made).length;
}
lines.push(sum);

// Another callee, another receiver, values that are no objects, an object that may not change.
holder.run = negate;
lines.push(call(holder, 5), call({ run: describe, name: "other" }, 6), call(holder, 7));
holder.run = describe;
lines.push(call(holder, 8));
lines.push(store(new Payload(1), 2).value, store(new Payload(1), "text").value, store(new Payload(1), undefined).value, store(new Payload(1), null).value);
const frozen = Object.freeze(new Payload(1));
lines.push(store(frozen, { n: 2 }).value);
lines.push(store({ value: 0, other: 1 }, { n: 3 }).value.n, store(Object.create({ set value(v) { lines.push("setter " + v.n); } }), { n: 4 }).value);
const strictStore = new Function("payload", "result", "'use strict'; payload.value = result; return payload;");
for (let i = 0; i < 300; i++) strictStore(new Payload(i), { n: i });
try {
  strictStore(frozen, { n: 5 });
} catch (error) {
  lines.push(error.constructor.name);
}

// Callees that nothing else holds any more.
for (let round = 0; round < 3; round++) {
  const short = { run: n => n + round };
  let total = 0;
  for (let i = 0; i < 300; i++) total += call(short, i);
  lines.push(total);
  if (typeof Bun !== "undefined") Bun.gc(true);
}

// A prototype that gains a setter under a store that adds a property.
const add = new Function("object", "value", "object.added = value; return object;");
const prototype = Object.create(null);
for (let i = 0; i < 300; i++) add(Object.create(prototype), i);
Object.defineProperty(prototype, "added", { set(value) { lines.push("inherited setter " + value); }, configurable: true });
lines.push(Object.keys(add(Object.create(prototype), 1)).length);
delete prototype.added;
lines.push(Object.keys(add(Object.create(prototype), 2)).length);

const totals = await Promise.all([wait([1, Promise.resolve(2), 3.5]), wait([]), ...Array.from({ length: 200 }, (_, i) => wait([i, i]))]);
lines.push(totals.reduce((a, b) => a + b, 0));
console.log(lines.join("\n"));
