function sum(record: Record<string, number | undefined>): number { let total = 0; for (const [key, value = 10] of Object.entries(record)) total += key.length + value; return total; }
function ofMap(map: Map<string, number | undefined>): number { let total = 0; for (const [key = "none", value = 10] of map) total += key.length + value; return total; }
function ofPairs(pairs: [string?, number?][]): number { let total = 0; for (const [key = "none", value = 10] of pairs) total += key.length + value; return total; }
let out = ""; for (let round = 0; round < 30; round++) out = sum({ a: round, bb: undefined }) + " " + ofMap(new Map([["a", round], ["bb", undefined]])) + " " + ofPairs([["a", round], [], [undefined, 3], ["ccc"]]); console.log(out);
