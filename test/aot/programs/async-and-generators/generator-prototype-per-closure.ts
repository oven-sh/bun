// Every closure of a generator function has its own `prototype` object, whether the generator it creates is stepped, finished, looped over, escapes or is never created.
const sink: unknown[] = [];
function stepped() { function* g() { yield 1; } const it = g(); it.next(); return g; }
function finished() { function* g() { yield 1; } const it = g(); it.next(); it.return(0 as any); return g; }
function looped() { function* g() { yield 1; yield 2; } let sum = 0; for (const x of g()) sum += x; sink.push(sum); return g; }
function escaped() { function* g() { yield 1; } sink.push(g()); return g; }
function neverCalled() { return function* () { yield 1; }; }
function asyncGenerator() { async function* g() { yield 1; } g().next(); return g; }
const makers: [string, () => any][] = [["stepped", stepped], ["finished", finished], ["looped", looped], ["escaped", escaped], ["never called", neverCalled], ["async generator", asyncGenerator]];
for (const [name, make] of makers) {
  const a = make(), b = make();
  const checks = [a !== b, a.prototype !== b.prototype, a() instanceof a, a() instanceof b, b() instanceof b, Object.getPrototypeOf(a()) === a.prototype, Object.getPrototypeOf(a.prototype) === Object.getPrototypeOf(b.prototype)];
  a.prototype.tag = name;
  checks.push(a().tag === name, b().tag === undefined);
  const before = a();
  a.prototype = { replaced: true };
  checks.push(a().replaced === true, b().replaced === undefined, before.replaced === undefined, before.tag === name);
  console.log(name + ": " + checks.join(" "));
}
export {};
