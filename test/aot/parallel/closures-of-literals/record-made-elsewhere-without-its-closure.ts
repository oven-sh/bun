type Options = { name: string; isExpected?: (e: unknown) => boolean };
const kept: Options[] = [];
function runs(o: Options, e: unknown) { kept.push(o); return o.isExpected?.(e); }
function takes(o: Options) { kept.push(o); return o.name; }
function one(k: number) { let n = k; return runs({ name: "a", isExpected: e => { n++; return n > 1; } }, 1); }
function two() { return takes({ name: "b" }); }
console.log(one(0), one(1), two(), kept.length);
