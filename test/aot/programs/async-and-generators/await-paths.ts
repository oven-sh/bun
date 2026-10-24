// Every way through an `await`: on settled, pending and rejected promises, with locals that must survive the suspension, and several calls in flight at once.
declare const console: { log(...v: unknown[]): void };
const done = (v: number): Promise<number> => Promise.resolve(v);
const later = (v: number): Promise<number> => Promise.resolve().then(() => v);
const fails = (v: number): Promise<number> => Promise.resolve().then(() => { throw new RangeError("r" + v); });
const at = (bits: number, i: number, v: number): Promise<number> => (bits >> i & 1 ? later(v) : done(v));

async function defined(bits: number, a: number): Promise<number> {
    const early = a * 3;
    let t = await at(bits, 0, 1);
    const mid = t + early;                    // defined in the resume body
    if (bits & 64) t += await at(bits, 1, mid); else t -= await at(bits, 2, 2);
    const late = mid * 2 + t;
    t += await at(bits, 3, late);
    if (t & 1) return early + mid;            // uses on one way only
    t += await at(bits, 4, 5);
    return t + early + mid + late;
}
async function loops(bits: number, n: number): Promise<number> {
    let s = 0, last = -1; const k = n * 7;
    for (let i = 0; i < n; i++) {
        if (i & 1) { s += await at(bits, i & 7, i); last = i; }
        for (let j = 0; j < 3; j++) s += k + j;   // a loop without a suspension that uses what is kept
        if (s > 400) break;
    }
    return s * 10 + last + k;
}
async function guarded(bits: number, a: number): Promise<string> {
    let where = "start", x = a; const fixed = a + 100;
    try {
        x += await at(bits, 0, 1); where = "one";
        if (bits & 32) x += await fails(x);
        x += await at(bits, 1, 2); where = "two";
        if (bits & 16) throw new TypeError("t" + x);
        where = "three";
    } catch (e) {
        where += ":" + (e as Error).message; x += await at(bits, 2, fixed);
    } finally {
        where += ":f"; x += await at(bits, 3, 1000);
    }
    return where + x + ":" + fixed;
}
async function cases(bits: number, a: number): Promise<number> {
    const u = a + 1, v = a + 2, w = a + 3;
    const which = await at(bits, 0, a & 3);
    switch (which) {
    case 0: return u + v;
    case 1: return (await at(bits, 1, u)) + w;
    case 2: { const z = await at(bits, 2, v); return z + u + w; }
    default: return u * v * w;
    }
}
class Holder { n = 5; async m(bits: number, a: number): Promise<number> { const b = a + this.n; await at(bits, 0, 0); this.n++; const c = b + this.n; if (bits & 2) await at(bits, 2, 0); return a + b + c + this.n; } }
function* walk(a: number, flag: boolean): Generator<number, string, number> {
    const p = a + 1, q = a + 2; let got = 0;
    try {
        got += yield p;
        if (flag) got += yield q; else got -= yield p + q;
        for (let i = 0; i < 2; i++) got += yield i + got;
    } finally { got += 1000; yield got + p; }
    return "end" + (got + p + q);
}
function drive(flag: boolean, stop: number, how: number): string {
    const g = walk(1, flag); const out: string[] = [];
    for (let i = 0; i < 9; i++) {
        let r: IteratorResult<number, string>;
        try { r = i === stop ? (how ? g.throw(new Error("x")) : g.return("ret")) : g.next(i); } catch (e) { out.push("!" + (e as Error).message); continue; }
        out.push(String(r.value) + (r.done ? "." : ""));
    }
    return out.join();
}
async function main(): Promise<void> {
    let a = 0, b = 0, d = 0, m = 0; const seen = new Map<string, number>();
    for (let bits = 0; bits < 128; bits++) {
        a = (a * 31 + await defined(bits, bits % 5)) % 1000003;
        b = (b * 31 + await loops(bits, bits % 9)) % 1000003;
        d = (d * 31 + await cases(bits, bits % 7)) % 1000003;
        m = (m * 31 + await new Holder().m(bits, bits % 3)) % 1000003;
        const g = await guarded(bits, bits % 4); seen.set(g, (seen.get(g) ?? 0) + 1);
    }
    console.log(a, b, d, m, seen.size, [...seen].slice(0, 6).join(" "));
    // Several at once: their frames are their own.
    console.log((await Promise.all([defined(127, 1), defined(0, 1), defined(85, 2), loops(255, 8), guarded(48, 1), guarded(16, 2), cases(7, 2)])).join());
    for (const flag of [true, false]) for (let stop = 0; stop < 7; stop += 2) for (const how of [0, 1]) console.log(drive(flag, stop, how));
}
main();
