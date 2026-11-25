// A record whose type lets the arrow function be left out is made with it in one function and without it in another. A read off the one without it gives undefined, and says nothing of whether the property is there.
type Options = { name: string; isExpected?: (e: unknown) => boolean };
const kept: Options[] = [];
function one(k: number): Options { let n = k; const o: Options = { name: "a", isExpected: e => { n++; return n > 1; } }; kept.push(o); return o; }
function two(): Options { const o: Options = { name: "b" }; kept.push(o); return o; }
const a = one(0), b = two();
const readOffA = a.isExpected, readOffB = b.isExpected;
console.log(typeof readOffA, typeof readOffB, "isExpected" in a, "isExpected" in b, Object.hasOwn(a, "isExpected"), Object.hasOwn(b, "isExpected"));
console.log(b.isExpected === undefined, a.isExpected === a.isExpected, a.isExpected === readOffA, kept[0].isExpected === readOffA);
