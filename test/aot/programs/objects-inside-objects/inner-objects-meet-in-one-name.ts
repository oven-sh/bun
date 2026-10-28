// One name stands for the inner object of this outer object or of that one, for an inner object or an object that has a cell, for an inner object or nothing: `flag ? x.a : y.a`, a name that a loop carries round, `x.a ?? other`.
// Behind such a meeting nobody knows the outer object any more, and the name still reads, stores, and is held.
interface Inner { b: number; s: string; r: { v: number } | null }
interface Outer { a: Inner; n: number }
interface Loose { o?: Inner | null; n: number }
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
const held: Inner[] = [];
function make(i: number): Outer { return { a: { b: i, s: "s" + i, r: i & 1 ? { v: i } : null }, n: i }; }
function makeLoose(i: number): Loose { return i % 3 === 0 ? { o: null, n: i } : i % 3 === 1 ? { o: { b: i, s: "l" + i, r: null }, n: i } : { n: i }; }
const own: Inner = { b: -1, s: "own", r: null };

function either(flag: boolean, x: Outer, y: Outer): number { const c = flag ? x.a : y.a; c.b += 1; return c.b + c.s.length + (c.r ? c.r.v : 0); }
function eitherOrOwn(flag: boolean, x: Outer): number { const c = flag ? x.a : own; c.b += 2; return c.b + c.s.length; }
function eitherHeld(flag: boolean, x: Outer, y: Outer): boolean { const c = flag ? x.a : y.a; held.push(c); c.b += 3; return c === (flag ? x.a : y.a) && held[held.length - 1].b === c.b; }
function heldBetween(flag: boolean, x: Outer, y: Outer): number { const c = flag ? x.a : y.a; const before = c.b; held.push(x.a); c.b = before + 4; return x.a.b * 1000 + y.a.b; }
function storedBetween(flag: boolean, x: Outer, y: Outer): number { const c = flag ? x.a : y.a; x.a = { b: 500, s: "fresh", r: null }; c.b += 5; return x.a.b * 1000 + c.b; }
function carriedRound(all: Outer[]): number { let c = all[0].a; let sum = 0; for (let i = 1; i < all.length; i++) { sum += c.b; c.b += 1; c = all[i].a; } return sum + c.b; }
function carriedRoundAndHeld(all: Outer[], at: number): number { let c = all[0].a; let sum = 0; for (let i = 1; i < all.length; i++) { sum += c.b; if (i === at) held.push(c); c = all[i].a; } return sum + held[held.length - 1].b; }
function orOther(x: Loose): number { const c = x.o ?? own; return c.b + c.s.length; }
function maybe(x: Loose): number { const c = x.o; return c ? c.b + c.s.length : c === null ? -1 : -2; }
function overHoles(all: (Outer | undefined)[]): number { let sum = 0; for (let i = 0; i < all.length; i++) { const x = all[i]; if (x) sum += x.a.b + x.a.s.length; } return sum; }
function ofAll(all: Outer[]): number { let sum = 0; for (const x of all) { const c = x.n & 1 ? x.a : all[0].a; sum += c.b; } return sum; }
// The name stands for what the read gave one round ago, and is used behind the read of this round. What ran in between lies in front of that read.
function usedBehindTheNextRead(all: Outer[], between: (x: Outer) => void): number { let c = all[0].a; let sum = 0; for (let i = 1; i < all.length; i++) { between(all[i - 1]); const next = all[i].a; sum += c.b + c.s.length; c.b += 1; c = next; } return sum; }
function returned(flag: boolean, x: Outer, y: Outer): Inner { return flag ? x.a : y.a; }
function throughThree(k: number, x: Outer, y: Outer, z: Outer): number { let c = x.a; if (k === 1) c = y.a; else if (k === 2) c = z.a; const d = k > 2 ? own : c; d.b += 7; return d.b; }

const all: Outer[] = [];
for (let part = 0; part < 4; part++) for (let half = 0; half < 4; half++) for (let i = 0; i < 250; i++) all.push(make(all.length));
const loose: Loose[] = [];
for (let part = 0; part < 4; part++) for (let i = 0; i < 300; i++) loose.push(makeLoose(loose.length));

say("either", either(true, all[1], all[2]), either(false, all[1], all[2]), either(true, all[3], all[3]), all[1].a.b, all[2].a.b, all[3].a.b);
say("either or an object with a cell", eitherOrOwn(true, all[4]), eitherOrOwn(false, all[4]), all[4].a.b, own.b);
say("held behind the meeting", eitherHeld(true, all[5], all[6]), eitherHeld(false, all[5], all[6]), eitherHeld(true, all[7], all[7]), all[5].a.b, all[6].a.b, all[7].a.b, held.length);
say("held between", heldBetween(true, all[8], all[9]), heldBetween(false, all[8], all[9]), heldBetween(true, all[10], all[10]), heldBetween(false, all[11], all[11]));
say("stored between", storedBetween(true, all[12], all[13]), storedBetween(false, all[12], all[13]), storedBetween(true, all[14], all[14]), all[12].a.s, all[13].a.b);
say("carried round", carriedRound(all), carriedRound(all.slice(0, 3)), carriedRoundAndHeld(all, 40), carriedRoundAndHeld(all, 41), held[held.length - 1] === all[40].a);
let sum = 0;
for (let i = 0; i < loose.length; i++) sum += orOther(loose[i]) * 3 + maybe(loose[i]);
say("or another, or nothing", sum);
delete loose[1].o; loose[4].o = own; loose[7].o = undefined; loose[10].o = { b: 1000, s: "again", r: null };
sum = 0;
for (let i = 0; i < loose.length; i++) sum += orOther(loose[i]) * 3 + maybe(loose[i]);
say("or another, or nothing", sum, "o" in loose[1], loose[4].o === own, loose[10].o!.b);
const holes: (Outer | undefined)[] = all.slice(0, 100); delete holes[7]; holes[50] = undefined; holes.length = 120;
say("over holes", overHoles(holes), ofAll(all));
{
  const some: Outer[] = []; for (let part = 0; part < 4; part++) for (let i = 0; i < 25; i++) some.push(make(some.length + 7000));
  say("used behind the next read", usedBehindTheNextRead(some, x => { if (x.n % 5 === 0) x.a = { b: -100, s: "", r: null }; }), some[0].a.b, some[1].a.b, some[5].a.b);
  say("used behind the next read", usedBehindTheNextRead(some, x => { if (x.n % 7 === 0) held.push(x.a); }), usedBehindTheNextRead(some, x => { x.a.b += 10; }), usedBehindTheNextRead(some, () => {}), some[7].a.b, held[held.length - 1].b);
}
say("returned", returned(true, all[20], all[21]) === all[20].a, returned(false, all[20], all[21]).s, returned(true, all[22], all[22]) === returned(false, all[22], all[22]));
say("through three", throughThree(0, all[30], all[31], all[32]), throughThree(1, all[30], all[31], all[32]), throughThree(2, all[30], all[31], all[32]), throughThree(3, all[30], all[31], all[32]), all[30].a.b, all[31].a.b, all[32].a.b, own.b);
Bun.gc(true);
sum = 0;
for (let i = 0; i < all.length; i++) sum += all[i].a.b + all[i].a.s.length + (all[i].a.r ? all[i].a.r!.v : 0);
for (const inner of held) sum += inner.b;
say("all", sum, held.length);
console.log(lines.join("\n"));
