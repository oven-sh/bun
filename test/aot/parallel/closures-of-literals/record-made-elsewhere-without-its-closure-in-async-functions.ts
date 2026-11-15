type Options = { name: string; isExpected?: (e: unknown) => boolean };
const kept: Options[] = [];
function runs(o: Options, e: unknown) { kept.push(o); return o.isExpected?.(e); }
function takes(o: Options) { kept.push(o); return o.name; }
async function one(k: number) { let n = k; await null; return runs({ name: "a", isExpected: e => { n++; return n > 1; } }, 1); }
async function two() { await null; return takes({ name: "b" }); }
one(0).then(console.log); two().then(console.log);
