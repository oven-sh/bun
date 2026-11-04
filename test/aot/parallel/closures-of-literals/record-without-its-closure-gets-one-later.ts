type Options = { name: string; isExpected?: (e: unknown) => boolean };
const kept: Options[] = [];
function one(k: number): Options { let n = k; const o: Options = { name: "a", isExpected: e => { n++; return n > 1; } }; kept.push(o); return o; }
function two(): Options { const o: Options = { name: "b" }; kept.push(o); return o; }
const first = one(0), second = two();
second.isExpected = first.isExpected;
console.log(second.isExpected === first.isExpected, second.isExpected!(1), first.isExpected!(1), Object.keys(second).join());
