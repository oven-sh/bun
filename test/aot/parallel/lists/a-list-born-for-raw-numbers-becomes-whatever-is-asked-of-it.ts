const seed = process.argv.length;
const say = (label: string, value: unknown): void => console.log(label, JSON.stringify(value), Array.isArray(value) ? value.length : "");
function fractions(): number[] { return [seed + 0.5, seed / 3, 2.5]; }
function whole(): number[] { return [seed, seed + 1, 2]; }
function withNaN(): number[] { return [seed + 0.5, Number("x"), 0 / (seed - seed)]; }
function zeros(): number[] { return [-0 * seed, 0 * seed, -seed + seed]; }
for (let turn = 0; turn < 200; turn++) {
    const last = turn === 199;
    const a = fractions(); (a as unknown[])[1] = "text"; (a as unknown[]).push({ k: turn }); if (last) say("a text and an object into doubles", a);
    const b = whole(); b[1] = 0.25; b.push(2 ** 31, -(2 ** 31) - 1); if (last) say("a fraction and what no int32 holds into int32s", b);
    const c = whole(); (c as unknown[])[0] = undefined; (c as unknown[])[2] = null; if (last) say("undefined and null into int32s", c);
    const d = fractions(); d[7] = 1.5; if (last) { say("a store far behind the end", d); console.log(1 in d, 5 in d, d.indexOf(1.5), Object.keys(d).join()); }
    const e = fractions(); delete (e as unknown as Record<number, number>)[1]; if (last) { say("a deleted element", e); console.log(e[1], 1 in e); }
    const f = withNaN(); if (last) { say("NaN among the elements", f); console.log(f.includes(NaN), f.indexOf(NaN), 1 in f, 2 in f, f[1], f[2], Object.keys(f).join()); }
    const g = zeros(); if (last) console.log(Object.is(g[0], -0), Object.is(g[1], 0), Object.is(g[2], 0), 1 / g[0]!);
    const h = fractions(); h.length = 1; h.length = 3; if (last) { say("cut and grown again", h); console.log(1 in h); }
    const i = fractions().concat(whole(), withNaN()); if (last) say("joined", i);
    const j = [...fractions(), ...whole()].sort((x, y) => x - y).reverse().map(x => x * 2).filter(x => x > 4); if (last) say("spread, sorted, mapped, filtered", j);
    const k = Object.freeze(fractions()); try { (k as number[])[0] = 1; } catch (error) { if (last) console.log((error as Error).constructor.name); } if (last) say("frozen", k);
    const l = whole(); l.fill(0.5, 1); l.copyWithin(0, 1); l.unshift(9.5); l.splice(1, 1, 7, 8); if (last) say("filled, copied within, unshifted, spliced", l);
    const m = fractions(); Object.defineProperty(m, 1, { get: () => turn }); if (last) { console.log(m[1], m[0]! + m[1]! + m[2]!); }
    const [n0, n1, n2, n3] = fractions(); if (last) console.log(n0, n1, n2, n3);
    const o = new Float64Array(fractions()), p = new Set(whole()), q = Math.max(...fractions()); if (last) console.log(o.join(), p.size, q);
}
