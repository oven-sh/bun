// A function that ends in a call whose result must be tested, and that many typed callers call directly. The program does the same as with few callers: a result of another kind than the written return type throws a TypeError (under an `as` an object passes), whoever receives it and whatever the receiver does with it, and a cycle of tail calls runs in constant stack space.
function attempt(what: () => unknown): string { try { const got = what(); return typeof got + " " + String(got); } catch (e) { return (e as Error).constructor.name; } }
const g: any = globalThis;
function num(f: (x: number) => number, x: number): number { return f(x); }
function either(f: (x: number) => number, h: (x: number) => number, x: number): number { return x > 0 ? f(x) : h(x); }
function orElse(f: (x: number) => number, x: number): number { return x > 100 ? x : f(x); }
function viaAs(f: () => unknown): number { return f() as number; }
function viaDirect(x: number): number { return loose(x) as number; }
function loose(x: number): unknown { return x > 0 ? "loose" + x : x; }
function twice(f: (x: number) => number, x: number): number { return num(f, x); }
class Box {
  constructor(public f: (x: number) => number) {}
  run(x: number): number { return this.f(x); }
  static of(f: (x: number) => number, x: number): number { return new Box(f).run(x); }
}
interface Row { id: number }
function row(f: () => Row): Row { return f(); }
g.keep = [num, either, orElse, viaAs, viaDirect, twice, row];
const bad: any = (x: number) => "s" + x;
const good = (x: number) => x + 1;
const list: any = () => [1];
const text: any = () => "4";
const rows: [string, () => unknown][] = [
  ["by value, to whoever takes anything", () => num(bad, 5)],
  ["by value, into a typed variable", () => { const r: number = num(bad, 5); return r; }],
  ["by value, used as a number", () => num(bad, 5) + 1],
  ["by value, what the type says", () => num(good, 5) + 1],
  ["one of two", () => either(good, bad, -1)],
  ["one of two, used", () => either(good, bad, -1) + 1],
  ["one of two, the other", () => either(good, bad, 1) + 1],
  ["its own result or a call's", () => orElse(bad, 5)],
  ["its own result or a call's, used", () => orElse(bad, 5) + 1],
  ["its own result", () => orElse(bad, 500) + 1],
  ["through two functions", () => twice(bad, 5)],
  ["through two functions, used", () => twice(bad, 5) + 1],
  ["as, to whoever takes anything", () => viaAs(list)],
  ["as, into a typed variable", () => { const r: number = viaAs(list); return r; }],
  ["as, a text", () => viaAs(text)],
  ["as, a text, used", () => viaAs(text) + 1],
  ["as on a known function", () => viaDirect(1)],
  ["as on a known function, used", () => viaDirect(1) + 1],
  ["as on a known function, what the type says", () => viaDirect(-1) + 1],
  ["a method", () => new Box(bad).run(5)],
  ["a method, used", () => new Box(bad).run(5) + 1],
  ["a static method", () => Box.of(bad, 5)],
  ["a static method, used", () => Box.of(bad, 5) + 1],
  ["an object type", () => row(text)],
  ["an object type, read", () => row(text).id],
  ["a comparator", () => [1, 2].sort(() => list() as number).join()],
  ["a mapper", () => [1, 2].map(() => text() as number).map(x => typeof x).join()],
  ["a mapper by value", () => [1, 2].map(x => num(bad, x)).map(x => typeof x).join()],
  ["taken as a value", () => (g.keep[0] as any)(bad, 5)],
  ["taken as a value, as", () => (g.keep[3] as any)(list)],
];
for (let round = 0; round < 3; round++) for (const [name, what] of rows) console.log(round, name + ": " + attempt(what));

type Step = (n: number, total: number) => number;
const steps: { even: Step; odd: Step } = {
  even: (n, total) => n === 0 ? total : steps.odd(n - 1, total + 1),
  odd: (n, total) => n === 0 ? total : (steps.even(n - 1, total + 2) as unknown as number),
};
console.log("300,000 calls deep:", steps.even(300000, 0));


function hop(n: number, next: (n: number) => number): number { return n === 0 ? 0 : next(n - 1); }
const again = (n: number): number => hop(n, again);
function count(n: number, done: (n: number) => number): number { return n === 0 ? done(n) : count(n - 1, done); }
g.keep.push(hop, count);
function manyTypedCallers(): number {
  let sum = 0;
  sum += num(good, 1); sum += num(good, 2); sum += num(good, 3); sum += num(good, 4); sum += num(good, 5); sum += num(good, 6); sum += num(good, 7); sum += num(good, 8);
  sum += num(good, 9); sum += num(good, 10); sum += num(good, 11); sum += num(good, 12); sum += num(good, 13); sum += num(good, 14); sum += num(good, 15); sum += num(good, 16);
  sum += num(good, 17); sum += num(good, 18); sum += num(good, 19); sum += num(good, 20); sum += num(good, 21); sum += num(good, 22); sum += num(good, 23); sum += num(good, 24);
  sum += num(good, 25); sum += num(good, 26); sum += num(good, 27); sum += num(good, 28); sum += num(good, 29); sum += num(good, 30); sum += num(good, 31); sum += num(good, 32);
  sum += num(good, 33); sum += num(good, 34); sum += num(good, 35); sum += num(good, 36); sum += num(good, 37); sum += num(good, 38); sum += num(good, 39); sum += num(good, 40);
  sum += either(good, good, 1); sum += either(good, good, 2); sum += either(good, good, 3); sum += either(good, good, 4); sum += either(good, good, 5); sum += either(good, good, 6); sum += either(good, good, 7); sum += either(good, good, 8);
  sum += either(good, good, 9); sum += either(good, good, 10); sum += either(good, good, 11); sum += either(good, good, 12); sum += either(good, good, 13); sum += either(good, good, 14); sum += either(good, good, 15); sum += either(good, good, 16);
  sum += either(good, good, 17); sum += either(good, good, 18); sum += either(good, good, 19); sum += either(good, good, 20); sum += either(good, good, 21); sum += either(good, good, 22); sum += either(good, good, 23); sum += either(good, good, 24);
  sum += either(good, good, 25); sum += either(good, good, 26); sum += either(good, good, 27); sum += either(good, good, 28); sum += either(good, good, 29); sum += either(good, good, 30); sum += either(good, good, 31); sum += either(good, good, 32);
  sum += either(good, good, 33); sum += either(good, good, 34); sum += either(good, good, 35); sum += either(good, good, 36); sum += either(good, good, 37); sum += either(good, good, 38); sum += either(good, good, 39); sum += either(good, good, 40);
  sum += orElse(good, 1); sum += orElse(good, 2); sum += orElse(good, 3); sum += orElse(good, 4); sum += orElse(good, 5); sum += orElse(good, 6); sum += orElse(good, 7); sum += orElse(good, 8);
  sum += orElse(good, 9); sum += orElse(good, 10); sum += orElse(good, 11); sum += orElse(good, 12); sum += orElse(good, 13); sum += orElse(good, 14); sum += orElse(good, 15); sum += orElse(good, 16);
  sum += orElse(good, 17); sum += orElse(good, 18); sum += orElse(good, 19); sum += orElse(good, 20); sum += orElse(good, 21); sum += orElse(good, 22); sum += orElse(good, 23); sum += orElse(good, 24);
  sum += orElse(good, 25); sum += orElse(good, 26); sum += orElse(good, 27); sum += orElse(good, 28); sum += orElse(good, 29); sum += orElse(good, 30); sum += orElse(good, 31); sum += orElse(good, 32);
  sum += orElse(good, 33); sum += orElse(good, 34); sum += orElse(good, 35); sum += orElse(good, 36); sum += orElse(good, 37); sum += orElse(good, 38); sum += orElse(good, 39); sum += orElse(good, 40);
  sum += viaAs(() => 1); sum += viaAs(() => 2); sum += viaAs(() => 3); sum += viaAs(() => 4); sum += viaAs(() => 5); sum += viaAs(() => 6); sum += viaAs(() => 7); sum += viaAs(() => 8);
  sum += viaAs(() => 9); sum += viaAs(() => 10); sum += viaAs(() => 11); sum += viaAs(() => 12); sum += viaAs(() => 13); sum += viaAs(() => 14); sum += viaAs(() => 15); sum += viaAs(() => 16);
  sum += viaAs(() => 17); sum += viaAs(() => 18); sum += viaAs(() => 19); sum += viaAs(() => 20); sum += viaAs(() => 21); sum += viaAs(() => 22); sum += viaAs(() => 23); sum += viaAs(() => 24);
  sum += viaAs(() => 25); sum += viaAs(() => 26); sum += viaAs(() => 27); sum += viaAs(() => 28); sum += viaAs(() => 29); sum += viaAs(() => 30); sum += viaAs(() => 31); sum += viaAs(() => 32);
  sum += viaAs(() => 33); sum += viaAs(() => 34); sum += viaAs(() => 35); sum += viaAs(() => 36); sum += viaAs(() => 37); sum += viaAs(() => 38); sum += viaAs(() => 39); sum += viaAs(() => 40);
  sum += viaDirect(-1); sum += viaDirect(-2); sum += viaDirect(-3); sum += viaDirect(-4); sum += viaDirect(-5); sum += viaDirect(-6); sum += viaDirect(-7); sum += viaDirect(-8);
  sum += viaDirect(-9); sum += viaDirect(-10); sum += viaDirect(-11); sum += viaDirect(-12); sum += viaDirect(-13); sum += viaDirect(-14); sum += viaDirect(-15); sum += viaDirect(-16);
  sum += viaDirect(-17); sum += viaDirect(-18); sum += viaDirect(-19); sum += viaDirect(-20); sum += viaDirect(-21); sum += viaDirect(-22); sum += viaDirect(-23); sum += viaDirect(-24);
  sum += viaDirect(-25); sum += viaDirect(-26); sum += viaDirect(-27); sum += viaDirect(-28); sum += viaDirect(-29); sum += viaDirect(-30); sum += viaDirect(-31); sum += viaDirect(-32);
  sum += viaDirect(-33); sum += viaDirect(-34); sum += viaDirect(-35); sum += viaDirect(-36); sum += viaDirect(-37); sum += viaDirect(-38); sum += viaDirect(-39); sum += viaDirect(-40);
  sum += twice(good, 1); sum += twice(good, 2); sum += twice(good, 3); sum += twice(good, 4); sum += twice(good, 5); sum += twice(good, 6); sum += twice(good, 7); sum += twice(good, 8);
  sum += twice(good, 9); sum += twice(good, 10); sum += twice(good, 11); sum += twice(good, 12); sum += twice(good, 13); sum += twice(good, 14); sum += twice(good, 15); sum += twice(good, 16);
  sum += twice(good, 17); sum += twice(good, 18); sum += twice(good, 19); sum += twice(good, 20); sum += twice(good, 21); sum += twice(good, 22); sum += twice(good, 23); sum += twice(good, 24);
  sum += twice(good, 25); sum += twice(good, 26); sum += twice(good, 27); sum += twice(good, 28); sum += twice(good, 29); sum += twice(good, 30); sum += twice(good, 31); sum += twice(good, 32);
  sum += twice(good, 33); sum += twice(good, 34); sum += twice(good, 35); sum += twice(good, 36); sum += twice(good, 37); sum += twice(good, 38); sum += twice(good, 39); sum += twice(good, 40);
  sum += row(() => ({ id: 1 })).id; sum += row(() => ({ id: 2 })).id; sum += row(() => ({ id: 3 })).id; sum += row(() => ({ id: 4 })).id; sum += row(() => ({ id: 5 })).id; sum += row(() => ({ id: 6 })).id; sum += row(() => ({ id: 7 })).id; sum += row(() => ({ id: 8 })).id;
  sum += row(() => ({ id: 9 })).id; sum += row(() => ({ id: 10 })).id; sum += row(() => ({ id: 11 })).id; sum += row(() => ({ id: 12 })).id; sum += row(() => ({ id: 13 })).id; sum += row(() => ({ id: 14 })).id; sum += row(() => ({ id: 15 })).id; sum += row(() => ({ id: 16 })).id;
  sum += row(() => ({ id: 17 })).id; sum += row(() => ({ id: 18 })).id; sum += row(() => ({ id: 19 })).id; sum += row(() => ({ id: 20 })).id; sum += row(() => ({ id: 21 })).id; sum += row(() => ({ id: 22 })).id; sum += row(() => ({ id: 23 })).id; sum += row(() => ({ id: 24 })).id;
  sum += row(() => ({ id: 25 })).id; sum += row(() => ({ id: 26 })).id; sum += row(() => ({ id: 27 })).id; sum += row(() => ({ id: 28 })).id; sum += row(() => ({ id: 29 })).id; sum += row(() => ({ id: 30 })).id; sum += row(() => ({ id: 31 })).id; sum += row(() => ({ id: 32 })).id;
  sum += row(() => ({ id: 33 })).id; sum += row(() => ({ id: 34 })).id; sum += row(() => ({ id: 35 })).id; sum += row(() => ({ id: 36 })).id; sum += row(() => ({ id: 37 })).id; sum += row(() => ({ id: 38 })).id; sum += row(() => ({ id: 39 })).id; sum += row(() => ({ id: 40 })).id;
  sum += Box.of(good, 1); sum += Box.of(good, 2); sum += Box.of(good, 3); sum += Box.of(good, 4); sum += Box.of(good, 5); sum += Box.of(good, 6); sum += Box.of(good, 7); sum += Box.of(good, 8);
  sum += Box.of(good, 9); sum += Box.of(good, 10); sum += Box.of(good, 11); sum += Box.of(good, 12); sum += Box.of(good, 13); sum += Box.of(good, 14); sum += Box.of(good, 15); sum += Box.of(good, 16);
  sum += Box.of(good, 17); sum += Box.of(good, 18); sum += Box.of(good, 19); sum += Box.of(good, 20); sum += Box.of(good, 21); sum += Box.of(good, 22); sum += Box.of(good, 23); sum += Box.of(good, 24);
  sum += Box.of(good, 25); sum += Box.of(good, 26); sum += Box.of(good, 27); sum += Box.of(good, 28); sum += Box.of(good, 29); sum += Box.of(good, 30); sum += Box.of(good, 31); sum += Box.of(good, 32);
  sum += Box.of(good, 33); sum += Box.of(good, 34); sum += Box.of(good, 35); sum += Box.of(good, 36); sum += Box.of(good, 37); sum += Box.of(good, 38); sum += Box.of(good, 39); sum += Box.of(good, 40);
  sum += hop(1, again); sum += hop(2, again); sum += hop(3, again); sum += hop(4, again); sum += hop(5, again); sum += hop(6, again); sum += hop(7, again); sum += hop(8, again);
  sum += hop(9, again); sum += hop(10, again); sum += hop(11, again); sum += hop(12, again); sum += hop(13, again); sum += hop(14, again); sum += hop(15, again); sum += hop(16, again);
  sum += hop(17, again); sum += hop(18, again); sum += hop(19, again); sum += hop(20, again); sum += hop(21, again); sum += hop(22, again); sum += hop(23, again); sum += hop(24, again);
  sum += hop(25, again); sum += hop(26, again); sum += hop(27, again); sum += hop(28, again); sum += hop(29, again); sum += hop(30, again); sum += hop(31, again); sum += hop(32, again);
  sum += hop(33, again); sum += hop(34, again); sum += hop(35, again); sum += hop(36, again); sum += hop(37, again); sum += hop(38, again); sum += hop(39, again); sum += hop(40, again);
  sum += count(1, good); sum += count(2, good); sum += count(3, good); sum += count(4, good); sum += count(5, good); sum += count(6, good); sum += count(7, good); sum += count(8, good);
  sum += count(9, good); sum += count(10, good); sum += count(11, good); sum += count(12, good); sum += count(13, good); sum += count(14, good); sum += count(15, good); sum += count(16, good);
  sum += count(17, good); sum += count(18, good); sum += count(19, good); sum += count(20, good); sum += count(21, good); sum += count(22, good); sum += count(23, good); sum += count(24, good);
  sum += count(25, good); sum += count(26, good); sum += count(27, good); sum += count(28, good); sum += count(29, good); sum += count(30, good); sum += count(31, good); sum += count(32, good);
  sum += count(33, good); sum += count(34, good); sum += count(35, good); sum += count(36, good); sum += count(37, good); sum += count(38, good); sum += count(39, good); sum += count(40, good);
  return sum;
}
console.log("many typed callers:", manyTypedCallers());
const hops: number = hop(300000, again);
console.log("300,000 calls deep, entered by a typed caller:", hops);
const counted: number = count(300000, good);
console.log("300,000 calls of itself, then a call by value:", counted);
console.log("the last call gives a misfit:", attempt(() => { const r: number = count(3, bad); return r; }), "|", attempt(() => count(3, bad)), "|", attempt(() => (g.keep[8] as any)(3, bad)));
