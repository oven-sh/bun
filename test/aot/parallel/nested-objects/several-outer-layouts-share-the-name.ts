// One place reads, stores, tests or adds `a` on objects of several layouts, each of which is born with an inner literal of its own.
interface Inner { b: number }
interface Other { b: string; c: number }
interface One { a: Inner; one: number }
interface Two { a: Inner; two: string }
interface Three { a?: Inner; three: boolean }
interface Four { a: Other; four: number }
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
function makeOne(i: number): One { return { a: { b: i }, one: i }; }
function makeTwo(i: number): Two { return { a: { b: i * 2 }, two: "t" + i }; }
function makeThree(i: number): Three { return i % 2 ? { a: { b: i * 3 }, three: true } : { three: false }; }
function makeFour(i: number): Four { return { a: { b: "s" + i, c: i }, four: i }; }
function read(x: One | Two): number { return x.a.b; }
function readAny(x: One | Two | Four): number | string { return x.a.b; }
function readMaybe(x: One | Three): number { return x.a ? x.a.b : -1; }
function store(x: One | Two, i: number) { x.a = { b: i }; }
function bump(x: One | Two | Three) { if (x.a) x.a.b += 1; }
function add(x: Three, i: number) { x.a = { b: i }; }
function hold(x: One | Two | Three | Four): Inner | Other | undefined { return x.a; }
function has(x: One | Three): boolean { return "a" in x && x.a !== undefined; }

const all: (One | Two)[] = [];
for (let i = 0; i < 40; i++) all.push(i % 2 ? makeOne(i) : makeTwo(i));
let sum = 0;
for (const x of all) sum += read(x);
say("read", sum);
for (const x of all) bump(x);
for (const x of all) sum += read(x);
say("bumped", sum);
for (let i = 0; i < all.length; i += 3) store(all[i], 1000 + i);
for (const x of all) sum += read(x);
say("stored", sum);
const held = all.map(hold);
say("held", held.every((c, i) => c === all[i].a), held.map(c => (c as Inner).b).join());
for (const x of all) bump(x);
say("bumped behind", held.map(c => (c as Inner).b).join());

const threes: Three[] = [];
for (let i = 0; i < 10; i++) threes.push(makeThree(i));
say("maybe", threes.map(readMaybe).join(), threes.map(has).join(), threes.map(x => Object.keys(x).join("+")).join());
for (const x of threes) bump(x);
for (let i = 0; i < threes.length; i += 2) add(threes[i], 70 + i);
say("added", threes.map(readMaybe).join(), threes.map(has).join(), threes.map(x => Object.keys(x).join("+")).join());
for (let i = 0; i < threes.length; i += 3) delete threes[i].a;
say("deleted", threes.map(readMaybe).join(), threes.map(has).join(), threes.map(x => JSON.stringify(x)).join());
for (let i = 0; i < threes.length; i += 3) add(threes[i], 90 + i);
say("added again", threes.map(readMaybe).join(), threes.map(x => JSON.stringify(x)).join());

const mixed: (One | Two | Four)[] = [makeOne(1), makeTwo(2), makeFour(3), makeFour(4), makeOne(5)];
say("mixed", mixed.map(readAny).join(), mixed.map(hold).map(c => JSON.stringify(c)).join());
say("one", readMaybe(makeOne(7)), has(makeOne(8)), has(makeThree(2)), has(makeThree(3)));
console.log(lines.join("\n"));
