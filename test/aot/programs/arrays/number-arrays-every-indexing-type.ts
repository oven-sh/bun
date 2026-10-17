declare const console: { log(...values: unknown[]): void };
function sum(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function sumOf(a: number[]): number { let t = 0; for (const x of a) t += x; return t; }
function product(a: number[]): number { let t = 1; for (const x of a) t *= x; return t; }
function below(a: number[], limit: number): number { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] < limit) n++; return n; }
function notBelow(a: number[], limit: number): number { let n = 0; for (let i = 0; i < a.length; i++) if (!(a[i] < limit)) n++; return n; }
function bits(a: number[]): number { let t = 0; for (const x of a) t ^= x | 0; return t; }
function absent(a: number[]): number { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === undefined) n++; return n; }
function absentOf(a: number[]): number { let n = 0; for (const x of a) if (x === undefined) n++; return n; }
function kept(a: number[]): string { let s = ""; for (const x of a) s += String(x) + ","; return s; }
function both(a: number[]): string { let t = 0, n = 0; for (const x of a) { t += x; if (x === undefined) n++; } return t + " " + n; }
function text(a: number[]): string { let s = ""; for (let i = 0; i < a.length; i++) s = s + a[i]; return s; }
function last(a: number[]): number { return a[a.length - 1]; }
function plusOne(a: number[], i: number): number { return a[i] + 1; }
function carried(a: number[]): number | undefined { let x: number | undefined = -1; for (let i = 0; i < a.length; i++) x = a[i]; return x; }
function two(a: number[], b: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t; }
function tell(name: string, a: () => number[]): void {
    const show = (f: () => unknown) => { try { const v = f(); return Object.is(v, -0) ? "-0" : String(v); } catch (e) { return e instanceof TypeError ? "TypeError" : "threw"; } };
    console.log(name + ": " + [() => sum(a()), () => sumOf(a()), () => product(a()), () => below(a(), 2), () => notBelow(a(), 2), () => bits(a()), () => absent(a()), () => absentOf(a()), () => kept(a()), () => both(a()), () => text(a()), () => last(a()), () => plusOne(a(), 1), () => plusOne(a(), 99), () => carried(a()), () => two(a(), a()), () => two(a(), [1])].map(show).join(" | "));
}
for (let turn = 0; turn < 2; turn++) {
    tell("doubles", () => [1.5, 2.5, -3.25]);
    tell("whole numbers", () => [1, 2, 3]);
    tell("pushed halves", () => { const a: number[] = []; for (let i = 0; i < 4; i++) a.push(i / 2); return a; });
    tell("pushed whole", () => { const a: number[] = []; for (let i = 0; i < 4; i++) a.push(i); return a; });
    tell("empty", () => []);
    tell("NaN stored", () => [1.5, NaN, 2.5]);
    tell("NaN pushed", () => { const a = [1.5]; a.push(NaN); a.push(0 / 0); return a; });
    tell("-0", () => [-0, -0]);
    tell("infinities", () => [Infinity, -Infinity, 1]);
    tell("a hole among doubles", () => { const a = [1.5, 2.5, 3.5]; delete (a as unknown[])[1]; return a; });
    tell("a hole among whole numbers", () => { const a = [1, 2, 3]; delete (a as unknown[])[1]; return a; });
    tell("a hole at the end", () => { const a = [1.5, 2.5]; a.length = 3; return a; });
    tell("all holes", () => new Array<number>(3));
    tell("values", () => { const a: unknown[] = [1.5, "x", 3]; a[1] = 2; return a as number[]; });
    tell("values with a hole", () => { const a: unknown[] = [1.5, "x", 3]; delete a[1]; return a as number[]; });
    tell("undefined among values", () => [1.5, undefined as unknown as number, 3]);
    tell("JSON whole", () => JSON.parse("[1,2,3]"));
    tell("JSON mixed", () => JSON.parse("[1,2.5,3]"));
    tell("sparse", () => { const a = [1.5, 2.5]; a[150000] = 1; a.length = 4; return a; });
    tell("frozen", () => Object.freeze([1.5, 2.5]) as number[]);
    tell("denormals", () => [5e-324, 2.1219957905e-314, 1.7976931348623157e308]);
    tell("large whole", () => [2147483647, 2147483648, -2147483649, 9007199254740991]);
}
