function make(i: number): number[] { return [i + 0.5, i / 3, 2.5]; }
function whole(i: number): number[] { return [i, i + 1, i + 2]; }
const lie = (list: number[]) => list as unknown as unknown[];
for (const born of [make, whole]) {
    const a = born(1); lie(a)[1] = "text"; console.log(JSON.stringify(a), typeof a[1], a[0], a[2]);
    const b = born(1); lie(b).push({ name: "thing" }); console.log(JSON.stringify(b), b.length);
    const c = born(1); c[6] = 1.25; console.log(JSON.stringify(c), c.length, 4 in c, c[4]);
    const d = born(1); delete (d as { [index: number]: number })[0]; console.log(JSON.stringify(d), 0 in d, d[0], d.length);
    const e = born(1); e.length = 1; e.push(7.5); console.log(JSON.stringify(e));
    const f = born(1); f[0] = 0.125; f[1] = 9; f[2] = NaN; console.log(JSON.stringify(f), f[2], 2 in f);
    const g = born(1); lie(g)[0] = undefined; console.log(JSON.stringify(g), 0 in g, g[0]);
    const h = Object.freeze(born(1)); try { (h as number[])[0] = 5; } catch (error) { console.log((error as Error).constructor.name); } console.log(JSON.stringify(h), Object.isFrozen(h));
    const k = born(1); Object.defineProperty(k, 1, { get() { return 42; } }); console.log(k[0], k[1], k[2], JSON.stringify(k));
}
