// The size of a Map or a Set that was written as a constant, asked behind its first walk in the same function.
const lines: string[] = [];
function afterSpreadOfKeys(map: Map<string, unknown>): number { const keys = [...map.keys()]; return map.size * 1000 + keys.length; }
function afterForOf(map: Map<string, unknown>): number { let n = 0; for (const [key] of map) n += key.length; return map.size * 1000 + n; }
function afterForOfSet(set: Set<string>): number { let n = 0; for (const key of set) n += key.length; return set.size * 1000 + n; }
function afterSpreadOfSet(set: Set<string>): number { const keys = [...set]; return set.size * 1000 + keys.length; }
function afterForEach(set: Set<string>): number { let n = 0; set.forEach(key => { n += key.length; }); return set.size * 1000 + n; }
function beforeAndAfter(set: Set<string>): number { const before = set.size; let n = 0; for (const key of set) n += key.length; return before * 1000000 + set.size * 1000 + n; }
function twoWalks(set: Set<string>): number { let n = 0; for (const key of set) n += key.length; for (const key of set) n += key.length; return set.size * 1000 + n; }
function untyped(set: any): number { let n = 0; for (const key of set) n += key.length; return set.size * 1000 + n; }

lines.push("entries " + afterSpreadOfKeys(new Map<string, unknown>(Object.entries({ p: 1, q: "two" }))));
lines.push("pairs " + afterSpreadOfKeys(new Map<string, unknown>([["p", 1], ["q", "two"], ["r", 3]])));
lines.push("for-of " + afterForOf(new Map<string, unknown>([["p", 1], ["q", "two"], ["r", 3]])));
lines.push("set for-of " + afterForOfSet(new Set(["alpha", "beta", "gamma"])));
lines.push("set spread " + afterSpreadOfSet(new Set(["alpha", "beta", "gamma"])));
lines.push("set forEach " + afterForEach(new Set(["alpha", "beta", "gamma"])));
lines.push("before and after " + beforeAndAfter(new Set(["alpha", "beta", "gamma"])));
lines.push("two walks " + twoWalks(new Set(["alpha", "beta", "gamma"])));
lines.push("untyped " + untyped(new Set(["alpha", "beta", "gamma"])));
const kept = new Set(["alpha", "beta", "gamma", "delta"]);
lines.push("kept " + afterForOfSet(kept) + " " + afterForOfSet(kept) + " " + kept.size);
const keywords = new Map([["if", 1], ["else", 2], ["for", 3]]);
let total = 0;
for (const [word, token] of keywords) total += word.length * token;
lines.push("top level " + total + " " + keywords.size);
console.log(lines.join("\n"));
