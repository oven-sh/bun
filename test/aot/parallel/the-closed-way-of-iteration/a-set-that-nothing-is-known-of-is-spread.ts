class Odd extends Set<number> { *[Symbol.iterator](): any { yield 70; } }
const own = new Set([1, 2]); (own as any)[Symbol.iterator] = function* () { yield 80; };
const holed = new Set([1, 2, 3, 4]); holed.delete(2); holed.delete(4);
const mixed = new Set<unknown>([1, "a", 1.5, null, undefined, { k: 1 }, [2]]);
const big = new Set<number>(); for (let i = 0; i < 300; i++) big.add(i * 3);
(globalThis as any).shelf = { all: [new Set([1, 2, 3]), new Set(), holed, mixed, big, new Odd([1]), own, new Set(["x"])] };
const shelf: any = (globalThis as any).shelf;
let out = ""; for (let round = 0; round < 3; round++) for (const one of shelf.all) { const alone = [...one]; const between = [0, ...one, 1.5, ...one, "z"]; out += alone.length + ":" + JSON.stringify(alone.slice(0, 8)) + between.length + JSON.stringify(between.slice(-3)) + "|"; } console.log(out);
