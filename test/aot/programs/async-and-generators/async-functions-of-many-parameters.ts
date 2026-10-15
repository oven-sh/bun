// Async functions that take more parameters than there are registers, and use every one of them behind awaits.
const log: string[] = [];
function note(text: string): void {
    log.push(text);
}
interface Point { x: number; y: number }

let release: (() => void)[] = [];
function outside(): Promise<void> {
    return new Promise(resolve => { release.push(resolve); });
}

async function nine(a: number, b: string, c: Point, d: number, e: boolean, f: string[], g: number, h: Point | undefined, i: string): Promise<string> {
    note("nine starts " + a + b);
    await null;
    const first = a + d + g + c.x;
    await outside();
    const second = b + i + f.join("") + (e ? "t" : "f");
    await Promise.resolve(1);
    return first + second + (h ? h.y : "none") + c.y;
}

async function doubles(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): Promise<number> {
    await outside();
    const sum = a * 0.5 + b * 1.5 + c * 2.5 + d + e;
    await null;
    return sum + f / 2 + g / 4 + h / 8 + i + j + k * l;
}

async function mixed(a: number, b: number, c: string, d: number, e: Point, f: number, g: string, h: number, i: Point, j: number, k: string, ...rest: number[]): Promise<string> {
    try {
        await outside();
        if (a > 100)
            throw new Error("too big " + k + j);
        return [a, b, c, d, e.x, f, g, h, i.y, j, k, rest.length, rest.reduce((sum, value) => sum + value, 0)].join("|");
    } finally {
        await null;
        note("mixed finally " + c + g + k + e.y + i.x);
    }
}

class Holder {
    constructor(private name: string, private base: number) {}
    async method(a: number, b: number, c: number, d: string, e: string, f: Point, g: number, h: number, i: string): Promise<string> {
        await null;
        const early = this.name + a + b + c;
        await outside();
        return early + d + e + f.x + f.y + g + h + i + this.base;
    }
}

function closes(p: number, q: string, r: Point, s: number): (a: number, b: number, c: string, d: number, e: string, f: number) => Promise<string> {
    let count = 0;
    return async (a, b, c, d, e, f) => {
        count++;
        await outside();
        const early = p + q + r.x + s;
        await null;
        return early + "/" + a + b + c + d + e + f + "/" + count + r.y;
    };
}

async function defaults(a: number, b = a + 1, c = b + 1, d = c + 1, e = d + 1, f = e + 1, g = f + 1, h = g + 1, i = h + 1, j = i + 1): Promise<number> {
    await null;
    return a + b + c + d + e + f + g + h + i + j;
}

async function recursive(depth: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: string): Promise<string> {
    if (!depth)
        return h + (a + b + c + d + e + f + g);
    await null;
    const below = await recursive(depth - 1, b, c, d, e, f, g, a + 1, h + depth);
    return below + "<" + a;
}

async function main(): Promise<void> {
    const point = { x: 1, y: 2 };
    const results = await Promise.allSettled([
        nine(1, "b", point, 4, true, ["f", "g"], 7, undefined, "i"),
        nine(10, "B", { x: 5, y: 6 }, 40, false, [], 70, point, "I"),
        doubles(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
        doubles(0.5, 1.25, -3, 4e10, 5, 6, 7, 8, 9, 10, 11, 0.125),
        mixed(1, 2, "c", 4, point, 6, "g", 8, { x: 9, y: 10 }, 11, "k", 12, 13, 14),
        mixed(101, 2, "C", 4, point, 6, "G", 8, point, 11, "K"),
        new Holder("holder", 1000).method(1, 2, 3, "d", "e", point, 7, 8, "i"),
        closes(1, "q", point, 4)(1, 2, "c", 4, "e", 6),
        defaults(1),
        defaults(1, 10, undefined, 100),
        recursive(5, 1, 2, 3, 4, 5, 6, 7, "r"),
    ]);
    for (const result of results)
        note(result.status === "fulfilled" ? "fulfilled " + result.value : "rejected " + String(result.reason));
    let sum = 0;
    for (let round = 0; round < 300; round++)
        sum += await defaults(round, round, round) + (await recursive(2, round, 1, 2, 3, 4, 5, 6, "")).length;
    note("sum " + sum);
    finished = true;
}

let finished = false;
main();
function pump(): void {
    const waiting = release;
    release = [];
    for (const resolve of waiting)
        resolve();
    if (finished)
        console.log(log.join("\n"));
    else
        setTimeout(pump, 0);
}
setTimeout(pump, 0);
