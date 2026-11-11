function below(h: number, limit: number): string { let n = 0; for (; h < limit; h = (h * 3 + 1) >>> 0) { if (++n > 40) break; } return n + ":" + h; }
function notNegative(h: number): string { let n = 0; for (; h >= 0; h = (h * 5 + 7) >>> 0) { if (++n > 40) break; } return n + ":" + h; }
function notMinusOne(h: number): string { let n = 0; for (; h !== -1; h = (h + 4294967295) >>> 0) { if (++n > 40) break; } return n + ":" + h; }
function half(h: number): string { let n = 0; for (; h <= 2147483647; h = (h * 2 + 1) >>> 0) { if (++n > 40) break; } return n + ":" + h; }
function full(h: number): string { let n = 0; for (; h !== 4294967295; h = (h * 2 + 1) >>> 0) { if (++n > 40) break; } return n + ":" + h; }
const inf: number = JSON.parse("1e400");
const seeds: number[] = [...JSON.parse("[0,1,3,2147483647,-1,-2147483648,2147483648,4294967295,4294967296,0.5,-0]"), inf - inf];
const said: string[] = [];
for (const s of seeds) said.push([below(s, JSON.parse("4000000000")), below(s, JSON.parse("-5")), notNegative(s), notMinusOne(s), half(s), full(s)].join(" "));
console.log("SAID " + said.join(" | "));
export {};
