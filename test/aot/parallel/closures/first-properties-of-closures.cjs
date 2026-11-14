// A closure that Link has lost gets its first property in the stub, by the function and the name.
// COUNT: operation:operationAOTPutByIdSloppy <= 2400
const lost = [x => x];
globalThis.pass = value => lost.length > 5 ? null : value;
const makers = [
  i => globalThis.pass(function named(a, b) { return i + (a | 0); }),
  i => globalThis.pass(a => i + (a | 0)),
  i => globalThis.pass(async () => i),
  i => globalThis.pass({ method(a, b, c) { return i; } }.method),
  i => globalThis.pass(function () { return this === undefined ? i : i + 1; }),
  i => globalThis.pass((a, b = 1, ...rest) => [i, a, rest.length]),
];
const label = (f, value) => { f.label = value; return f; };
const other = (f, value) => { f.other = value; return f; };
const both = (f, value) => { f.first = value; f.second = f; f.third = value + 1; return f; };
function describe(f) {
  return [f.name, f.length, typeof f.prototype, f.hasOwnProperty("prototype"), Object.getOwnPropertyNames(f).join(), Object.keys(f).join(), JSON.stringify(Object.getOwnPropertyDescriptor(f, "label")), f.label, f.other, f.third].join(" | ");
}
for (const give of [label, other, both]) {
  for (const make of makers) {
    const seen = [];
    let last;
    for (let i = 0; i < 400; i++) {
      const f = give(make(i), i);
      if (i % 97 === 0) seen.push(f);
      last = f;
      if (i === 200 && globalThis.Bun) Bun.gc(true);
    }
    console.log(describe(last));
    console.log(seen.map(f => { const result = f(1); return result instanceof Promise ? "promise" : String(result); }).join(), seen.map(describe).join(" ; ").length);
  }
}
const made = label(makers[0](7), 1);
const prototype = made.prototype;
console.log(new made(1) instanceof made, prototype === made.prototype, prototype.constructor === made, Object.getPrototypeOf(new made) === prototype);
try { new (label(makers[1](7), 1))(); } catch (error) { console.log(error.constructor.name); }
console.log(delete made.label, made.label, delete made.name, made.name, "label" in made);
// Names that functions have of themselves.
for (const name of ["name", "length", "prototype"]) {
  for (let i = 0; i < 8; i++) {
    const f = makers[i % 2](i);
    f[name] = 5;
    if (name === "name") f.name = "x"; else if (name === "length") f.length = 9; else f.prototype = null;
    if (i > 5) console.log(name, String(f[name]), describe(f));
  }
}
// What lies above changes.
const log = [];
Object.defineProperty(Function.prototype, "label", { configurable: true, set(value) { log.push(value); }, get() { return "above"; } });
for (let i = 0; i < 6; i++) { const f = label(makers[i](i), i); if (Object.keys(f).length || f.label !== "above") console.log("own", i); }
console.log(log.join());
delete Function.prototype.label;
for (let i = 0; i < 60; i++) { const f = label(makers[i % 6](i), i); if (f.label !== i || Object.keys(f).join() !== "label") console.log("lost", i); }
Object.defineProperty(Function.prototype, "other", { configurable: true, value: 1, writable: false });
let refused = 0;
for (let i = 0; i < 60; i++) { const f = other(makers[i % 6](i), i + 5); if (f.other === 1) refused++; }
console.log(refused);
delete Function.prototype.other;
let stored = 0;
for (let i = 0; i < 60; i++) { const f = other(makers[i % 6](i), i + 5); if (f.other === i + 5) stored++; }
console.log(stored);
// Many functions under many names.
const names = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"];
const givers = [(f, v) => { f.a0 = v; }, (f, v) => { f.a1 = v; }, (f, v) => { f.a2 = v; }, (f, v) => { f.a3 = v; }, (f, v) => { f.a4 = v; }, (f, v) => { f.a5 = v; }, (f, v) => { f.a6 = v; }, (f, v) => { f.a7 = v; }];
let sum = 0;
for (let round = 0; round < 60; round++) {
  for (let n = 0; n < 8; n++) {
    const f = makers[(round + n) % 6](round);
    givers[n](f, round * n);
    givers[(n + 3) % 8](f, 1);
    if (f[names[n]] !== round * n || Object.keys(f).join() !== names[n] + "," + names[(n + 3) % 8]) console.log("wrong", round, n);
    sum += f[names[n]];
  }
}
console.log(sum);
