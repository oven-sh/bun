// An async function with many live local variables awaits other async functions on some paths and not on others.
declare const console: { log(...v: unknown[]): void };
async function g(a: number): Promise<number> { return a * 2; }
async function wide(a: number, flag: boolean): Promise<number> {
    const v0 = a * 2 + 0;
    const v1 = a * 3 + 1;
    const v2 = a * 4 + 2;
    const v3 = a * 5 + 3;
    const v4 = a * 6 + 4;
    const v5 = a * 7 + 5;
    const v6 = a * 8 + 6;
    const v7 = a * 9 + 7;
    const v8 = a * 10 + 8;
    const v9 = a * 11 + 9;
    const v10 = a * 12 + 10;
    const v11 = a * 13 + 11;
    let t = 0;
    if (flag) t += await g(0); else t -= await g(1);
    if (flag) t += await g(2); else t -= await g(3);
    if (flag) t += await g(4); else t -= await g(5);
    if (flag) t += await g(6); else t -= await g(7);
    if (flag) t += await g(8); else t -= await g(9);
    if (flag) t += await g(10); else t -= await g(11);
    if (flag) t += await g(12); else t -= await g(13);
    if (flag) t += await g(14); else t -= await g(15);
    if (flag) t += await g(16); else t -= await g(17);
    if (flag) t += await g(18); else t -= await g(19);
    return t + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
}
async function straight(a: number): Promise<number> {
    const v0 = a * 2 + 0;
    const v1 = a * 3 + 1;
    const v2 = a * 4 + 2;
    const v3 = a * 5 + 3;
    const v4 = a * 6 + 4;
    const v5 = a * 7 + 5;
    const v6 = a * 8 + 6;
    const v7 = a * 9 + 7;
    const v8 = a * 10 + 8;
    const v9 = a * 11 + 9;
    const v10 = a * 12 + 10;
    const v11 = a * 13 + 11;
    let t = 0;
    t += await g(0);
    t += await g(1);
    t += await g(2);
    t += await g(3);
    t += await g(4);
    t += await g(5);
    t += await g(6);
    t += await g(7);
    t += await g(8);
    t += await g(9);
    return t + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
}
async function looped(a: number, n: number): Promise<number> {
    const v0 = a * 2 + 0;
    const v1 = a * 3 + 1;
    const v2 = a * 4 + 2;
    const v3 = a * 5 + 3;
    const v4 = a * 6 + 4;
    const v5 = a * 7 + 5;
    const v6 = a * 8 + 6;
    const v7 = a * 9 + 7;
    const v8 = a * 10 + 8;
    const v9 = a * 11 + 9;
    const v10 = a * 12 + 10;
    const v11 = a * 13 + 11;
    let t = 0;
    for (let i = 0; i < n; i++) { if (i & 1) t += await g(i); else t -= await g(i + 1); try { t += await g(t); } catch (e) { t = -1; } }
    return t + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
}
async function changing(a: number, flag: boolean): Promise<number> {
    let x = a, y = a + 1, z = a + 2;
    if (flag) { x += await g(0); } else { y += await g(1); }
    if (x > y) z = x - y;
    if (flag) { x += await g(1); } else { y += await g(2); }
    if (x > y) z = x - y;
    if (flag) { x += await g(2); } else { y += await g(3); }
    if (x > y) z = x - y;
    if (flag) { x += await g(3); } else { y += await g(4); }
    if (x > y) z = x - y;
    return x * 100 + y * 10 + z;
}
function* gen(a: number, flag: boolean): Generator<number> {
    const v0 = a * 2 + 0;
    const v1 = a * 3 + 1;
    const v2 = a * 4 + 2;
    const v3 = a * 5 + 3;
    const v4 = a * 6 + 4;
    const v5 = a * 7 + 5;
    if (flag) yield 0; else yield 0;
    if (flag) yield 1; else yield -1;
    if (flag) yield 2; else yield -2;
    if (flag) yield 3; else yield -3;
    if (flag) yield 4; else yield -4;
    yield v0 + v1 + v2 + v3 + v4 + v5;
}
(globalThis as any).kept = [g, wide, straight, looped, changing, gen];
Promise.all([wide(1, true), wide(2, false), straight(3), looped(4, 5), looped(1, 0), changing(1, true), changing(5, false)]).then(r => console.log(r.join(), [...gen(1, true)].join(), [...gen(2, false)].join()));
