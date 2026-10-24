// One object is reached through two names in one function: one has the type of a class below a built-in class, the other the type of the parent. What is written through one is read through the other.
const lines: string[] = [];
class OnMap extends Map<string, number> { count = 1; twice(): number { return this.count * 2; } }
class OnSet extends Set<number> { count = 1; twice(): number { return this.count * 2; } }
class OnError extends Error { count = 1; twice(): number { return this.count * 2; } }
class OnDate extends Date { count = 1; twice(): number { return this.count * 2; } }
class OnRegExp extends RegExp { count = 1; twice(): number { return this.count * 2; } }
class OnBytes extends Uint8Array { count = 1; twice(): number { return this.count * 2; } }
function map(k: OnMap, m: Map<string, number>): string {
  const twice = k.twice();
  const before = k.get("x");
  const size = k.size;
  m.set("x", 5);
  m.set("y", 6);
  const between = k.get("x");
  k.set("x", 7);
  return [twice, before, size, between, k.size, m.get("x"), m.size, k.has("y"), m === k].join();
}
function set(k: OnSet, s: Set<number>): string {
  const twice = k.twice();
  const before = k.has(1);
  const size = k.size;
  s.add(1);
  const between = k.has(1);
  k.delete(1);
  return [twice, before, size, between, k.size, s.has(1), s.size].join();
}
function error(k: OnError, e: Error): string {
  const twice = k.twice();
  const before = k.message;
  e.message = "changed";
  const between = k.message;
  k.message = "again";
  (e as any).count = 5;
  return [twice, before, between, e.message, k.count, k.twice()].join();
}
function date(k: OnDate, d: Date): string {
  const twice = k.twice();
  const before = k.getTime();
  d.setTime(5);
  const between = k.getTime();
  k.setTime(6);
  return [twice, before, between, d.getTime()].join();
}
function regExp(k: OnRegExp, r: RegExp): string {
  const twice = k.twice();
  const before = k.lastIndex;
  r.lastIndex = 3;
  const between = k.lastIndex;
  k.lastIndex = 4;
  return [twice, before, between, r.lastIndex].join();
}
function bytes(k: OnBytes, b: Uint8Array): string {
  const twice = k.twice();
  const before = k[0];
  b[0] = 5;
  const between = k[0];
  k[0] = 6;
  return [twice, before, between, b[0], k.length, b.length].join();
}
function loop(k: OnMap, m: Map<string, number>): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    sum += k.twice() + (k.get("x") ?? 0) + k.size;
    m.set("x", i);
    if (i === 3) m.set("z" + i, i);
  }
  return sum;
}
for (let round = 0; round < 3; round++) {
  const m = new OnMap([["x", 1]]); lines.push(map(m, m), map(new OnMap([["x", 1]]), new Map()), map(new OnMap(), new OnMap()));
  const s = new OnSet(); lines.push(set(s, s), set(new OnSet(), new Set()));
  const e = new OnError("first"); lines.push(error(e, e), error(new OnError("first"), new Error("other")));
  const d = new OnDate(1); lines.push(date(d, d), date(new OnDate(1), new Date(2)));
  const r = new OnRegExp("a", "g"); lines.push(regExp(r, r), regExp(new OnRegExp("a", "g"), /b/g));
  const b = new OnBytes([1]); lines.push(bytes(b, b), bytes(new OnBytes([1]), new Uint8Array(1)));
  const l = new OnMap([["x", 1]]); lines.push(String(loop(l, l)), String(loop(new OnMap(), new Map())));
}
console.log(lines.join("\n"));
