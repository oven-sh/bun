function run(x) { const r = Array.from({ length: 2 }, x); return [r.length, r[0], 0 in r, typeof r[0], r.map(v => v === undefined).join(), JSON.stringify(r), r.includes(undefined), r.indexOf(undefined), String(r), r.every(v => v === undefined)]; }
console.log(run());
console.log(run(undefined));
function each(x) { let n = 0; for (const v of Array.from({ length: 3 }, x)) n += v === undefined ? 1 : 100; return n; }
console.log(each());
function withFunction(x) { return Array.from({ length: 2 }, x); }
console.log(withFunction((v, i) => i * 2), withFunction());
console.log(Array.from({ length: 2 }), Array.from({ length: 2, 0: "a" }, undefined), Array.from("ab", undefined), Array.from(new Set([1]), undefined));
