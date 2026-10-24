// Every value in the two literals is a constant, so the compiler may keep either of them, or both, as data of the executable. Each evaluation still makes objects of its own.
interface Inner { b: number; s: string }
interface Outer { a: Inner; n: number }
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
function make(): Outer { return { a: { b: 1, s: "one" }, n: 2 }; }
function makeFrozen(): Readonly<{ a: Readonly<Inner>; n: number }> { return Object.freeze({ a: Object.freeze({ b: 1, s: "one" }), n: 2 }); }
const TABLE = { first: { b: 1, s: "first" }, second: { b: 2, s: "second" } };
const DEEP = { a: { a: { b: 3, s: "deep" }, n: 4 }, n: 5 };

const list: Outer[] = [];
for (let i = 0; i < 1000; i++) list.push(make());
list[0].a.b = 5;
list[1].a = { b: 7, s: "seven" };
say(list[0].a.b, list[1].a.b, list[2].a.b, list[0].a === list[2].a, list[2].a === list[3].a, JSON.stringify(list[2]), JSON.stringify(list[0]));
let sum = 0;
for (const x of list) sum += x.a.b + x.a.s.length + x.n;
say(sum);
const held = list.map(x => x.a);
held[4].b = 40;
say(list[4].a.b, held[4] === list[4].a, new Set(held).size);

const frozen = [makeFrozen(), makeFrozen()];
say(frozen[0].a.b, frozen[0].a === frozen[1].a, Object.isFrozen(frozen[0].a), Object.isFrozen(frozen[0]));

say(TABLE.first.b + TABLE.second.b, TABLE.first.s, Object.keys(TABLE).join(), JSON.stringify(TABLE));
TABLE.first.b = 10;
TABLE.second = { b: 20, s: "stored" };
say(TABLE.first.b + TABLE.second.b, JSON.stringify(TABLE));
say(DEEP.a.a.b, DEEP.a.n, JSON.stringify(DEEP));
DEEP.a.a.b += 1;
const inner = DEEP.a;
DEEP.a = { a: { b: 30, s: "other" }, n: 40 };
say(inner.a.b, DEEP.a.a.b, inner === DEEP.a);
console.log(lines.join("\n"));
