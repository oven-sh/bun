export {};
interface Source { x: number | string; y: number; deep: { n: number | string } }
interface Copy extends Source { z: number }
function first(a: Source): Copy { return { ...a, z: 1 }; }
function second(a: Source): Copy { return { ...a, z: 2 }; }
function third(a: Source): Copy { return { z: 3, ...a }; }
function shadowedBehind(a: Source): Copy { return { ...a, x: "own", z: 4 }; }
function shadowedInFront(a: Source): Copy { return { x: "own", z: 5, ...(a as Partial<Source>) } as Copy; }
function same(a: Source): Source { return { ...a, y: a.y + 1 }; }
function sameAgain(a: Source): Source { return { ...a, x: a.x }; }
function twoSources(a: Source, b: Source): Copy { return { ...a, ...b, z: 6 }; }
function readX(c: Source): string { return typeof c.x === "number" ? "number " + (c.x + 1) : "text " + c.x.length; }
function readDeep(c: Source): string { return typeof c.deep.n === "number" ? "number " + (c.deep.n + 1) : "text " + c.deep.n.length; }
function tell(name: string, made: Source): void { console.log(name, readX(made), readDeep(made), made.y, JSON.stringify(made), Object.keys(made).join()); }
function all(a: Source): void {
  tell("first", first(a)); tell("second", second(a)); tell("third", third(a)); tell("shadowedBehind", shadowedBehind(a)); tell("shadowedInFront", shadowedInFront(a));
  tell("same", same(a)); tell("sameAgain", sameAgain(a)); tell("same of first", same(first(a))); tell("first of same", first(same(a)));
}
const numbers: Source = { x: 1, y: 2, deep: { n: 3 } };
for (let turn = 0; turn < 3; turn++) all(numbers);
const texts: Source = { x: "four", y: 5, deep: { n: "sixes" } };
all(texts);
const changed: Source = { x: 7, y: 8, deep: { n: 9 } };
const before = second(changed);
changed.x = "changed behind the copy";
changed.deep.n = "seen through both";
const behind = second(changed);
console.log(readX(before), readDeep(before), readX(behind), readDeep(behind), readX(changed));
before.x = "the copy alone";
console.log(readX(before), readX(changed), readX(same(before)), readX(sameAgain(sameAgain(before))));
console.log(JSON.stringify(twoSources(numbers, texts)), JSON.stringify(twoSources(texts, numbers)), readX(twoSources(numbers, texts)), readX(twoSources(texts, numbers)));

let calls = 0;
const withGetter = { get x(): number | string { calls++; return calls & 1 ? "by the getter" : calls; }, y: 1, deep: { n: 1 } };
all(withGetter); console.log(calls, Object.getOwnPropertyDescriptor(first(withGetter), "x")!.get === undefined);

class Above { inherited = 1; get x(): number | string { return "from above"; } method(): number { return 2; } }
class Below extends Above { y = 3; deep = { n: 4 }; }
for (const made of [first(new Below()), second(new Below()), third(new Below()), same(new Below())]) console.log(JSON.stringify(made), "x" in made, "method" in made, Object.getPrototypeOf(made) === Object.prototype);
const heir = Object.create(numbers) as Source; (heir as { y: number }).y = 10;
for (const made of [first(heir), second(heir), third(heir), same(heir)]) console.log(JSON.stringify(made), made.x === undefined ? "absent" : readX(made));
