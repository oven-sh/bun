// Powers whose exponent is known only when the program runs, in loops and outside, beside every special base.
const out: string[] = [];
const bases = [0, -0, 1, -1, 2, -2, 0.5, -0.5, 1.1, -1.1, 3, 10, -10, 1e10, 1e-10, 1e300, -1e300, 5e-324, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 53, Math.PI];
const exponents = [0, -0, 1, 2, 3, 4, 5, 7, 8, 10, 16, 31, 32, 63, 64, 100, 255, 999, 1000, 1001, 1024, -1, -2, -3, -0.5, 0.5, 1.5, 2.5, 1 / 3, 1e10, 2 ** 31, 2 ** 32, 2 ** 53, NaN, Infinity, -Infinity, 5e-324];
const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
const exact = (v: number) => { bits[0] = v; return v !== v ? "NaN" : words[1].toString(16) + ":" + words[0].toString(16); };
interface Pair { base: number; exponent: number }
const pairs: Pair[] = []; for (const base of bases) for (const exponent of exponents) pairs.push({ base, exponent });
function byMethod(list: Pair[]) { const r: string[] = []; for (const p of list) r.push(exact(Math.pow(p.base, p.exponent))); return r; }
function byOperator(list: Pair[]) { const r: string[] = []; for (let i = 0; i < list.length; i++) r.push(exact(list[i].base ** list[i].exponent)); return r; }
function oneByOne(p: Pair) { return exact(Math.pow(p.base, p.exponent)) + exact(p.base ** p.exponent); }
function assigned(list: Pair[]) { const r: string[] = []; for (const p of list) { let v = p.base; v **= p.exponent; r.push(exact(v)); } return r; }
function ofUnknown(list: any[]) { const r: string[] = []; for (const p of list) r.push(exact(p.base ** p.exponent) + exact(Math.pow(p.base, p.exponent))); return r; }
function ofIntegers(n: number) { let s = 0; for (let i = 0; i < n; i++) s = (s + (i % 7) ** (i % 5) + (i % 3) ** (i & 1)) % 1000003; return s; }
function summed(list: Pair[]) { let s = 0; for (const p of list) { const v = Math.pow(p.base, p.exponent); if (v === v && Math.abs(v) < 1e100) s += v; } return exact(s); }
out.push(byMethod(pairs).join(" "), byOperator(pairs).join(" "), assigned(pairs).join(" "), pairs.map(oneByOne).join(" "), ofUnknown(pairs).join(" "), String(ofIntegers(5000)), summed(pairs));
const converted: any[] = ["2", null, undefined, true, "x", { valueOf() { return 3; } }, [4], ""]; for (const b of converted) for (const e of converted) { let r = ""; for (let i = 0; i < 2; i++) r += exact(b ** e) + exact(Math.pow(b, e)); out.push(r); }
for (const f of [() => (2n as any) ** (2 as any), () => Math.pow(2n as any, 2), () => (Symbol() as any) ** 2, () => 2n ** -1n, () => 2n ** 10n]) { let r; try { r = String(f()); } catch (e: any) { r = e.constructor.name + ": " + e.message; } out.push(r); }
for (const line of out) console.log(line);
