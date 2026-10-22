// usage: <runtime> fuzz.mjs <seed> <count>  -> one digit per pair (3 x loose + strict; 0 equal, 1 not equal, 2 throws)
const m = await import("/workspace/bun/test/js/node/assert/deep-equal-random.ts");
console.log(m.verdicts(Number(process.argv[2]), Number(process.argv[3])));
