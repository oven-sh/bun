// parseInt and parseFloat of elements that may be missing, and of numbers of every size, in loops.
const told = (v: unknown): string => (Object.is(v, -0) ? "-0" : String(v));
const doubles: number[] = [], ints: number[] = [], edges: any[] = [0, -0, 1, -1, 0.5, -0.5, 1e-6, 9.99e-7, 1e-7, -1e-7, 123456.789, -123456.789, 2 ** 31, -(2 ** 31), 2 ** 53, 2 ** 53 - 1, -(2 ** 53), 1e20, 1e21, -1e21, 1.5e300, NaN, Infinity, -Infinity, 0.1 + 0.2];
for (let i = 0; i < 16; i++) { doubles.push(i * 1.37 - 5); ints.push(i * 7 - 30); }
const holes: number[] = [1.5, , 3.5] as number[], nullish: (number | null | undefined)[] = [1.9, null, undefined, -2.9, 7], mixed: any[] = ["12px", 3.7, null, undefined, "0x1f", true, { toString: () => "8.5" }, [9.5], 10n, "", " -4.4e1", "1e3"];
const out: string[] = [];
function ofDoubles(n: number) { let s = 0; for (let i = 0; i < n; i++) s += parseInt(doubles[i & 15] as any) * 3 + parseFloat(doubles[(i + 1) & 15] as any); return s; }
function ofInts(n: number) { let s = 0; for (let i = 0; i < n; i++) s += parseInt(ints[i & 15] as any, 10) + parseFloat(ints[i & 15] as any) + parseInt(ints[i & 15] as any, 0); return s; }
function outside(n: number) { let s = ""; for (let i = 0; i < n; i++) s = told(parseInt(doubles[i % 20] as any)) + told(parseFloat(doubles[i % 20] as any)) + told(parseInt(ints[i % 20] as any)); return s; }
function ofHoles(n: number) { let s = ""; for (let i = 0; i < n; i++) { s = told(parseInt(holes[i % 4] as any)) + told(parseFloat(holes[i % 4] as any)); if (i < 5) out.push(s); } return s; }
function ofNullish(n: number) { let s = ""; for (let i = 0; i < n; i++) { const v = nullish[i % 6]; s = told(parseInt(v as any)) + told(parseFloat(v as any)) + told(parseInt(v as any, 16)) + told(parseInt(v as any, undefined)); if (i < 6) out.push(s); } return s; }
function ofEdges(n: number) { let s = ""; for (let i = 0; i < n; i++) { const v = edges[i % 26]; s = told(parseInt(v)) + " " + told(parseFloat(v)) + " " + told(parseInt(v, 10)) + " " + told(parseInt(v, 8)); if (i < 26) out.push(i + " " + s); } return s; }
function typedEdges(n: number) { const e: number[] = edges.slice(); let s = ""; for (let i = 0; i < n; i++) { s = told(parseInt(e[i % 25] as any)) + " " + told(parseFloat(e[i % 25] as any)); if (i < 25) out.push(i + " " + s); } return s; }
function ofMixed(n: number) { let s = ""; for (let i = 0; i < n; i++) { const v = mixed[i % 12]; s = told(parseInt(v)) + " " + told(parseFloat(v)); if (i < 12) out.push(i + " " + s); } return s; }
function thrown(n: number) { let s = 0; const l: any[] = [1.5, { toString() { throw new RangeError("x"); } }, Symbol("s"), 2.5]; for (let i = 0; i < n; i++) { try { s += parseInt(l[i & 3]); } catch (e) { s += (e as Error).constructor.name.length; } } return s; }
for (let round = 0; round < 2; round++) { for (const f of [ofDoubles, ofInts, outside, ofHoles, ofNullish, ofEdges, typedEdges, ofMixed, thrown]) out.push(f.name + " " + f(60)); (doubles as any[])[3] = undefined; doubles[7] = NaN; (ints as any[]).push("17.5"); ints[2] = 2.5; }
for (const line of out) console.log(line);
export {};
