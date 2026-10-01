type H = (x: number, y: string) => boolean;
const h1: H = (a, b) => a.length > b.length;
const h2: H = function (a) { return a; };
const u1: { k: "a"; f: (x: string) => void } | { k: "b"; f: (x: number) => void } = { k: "b", f: x => x.length };
const tup: [number, (s: string) => void] = [1, s => s.toFixed()];
declare function call<T>(o: { v: T; use: (v: T) => void }): T;
const c1: string = call({ v: 1, use: v => v.length });
const arr: ((x: number) => void)[] = [x => x.length, (x, y) => {}];
const lit: "a" | "b" = Math.random() ? "a" : "c";
function ret(): (x: number) => string { return x => x; }
const p: Promise<number> | undefined = undefined;
const obj: { m(x: number): void; n: { deep: (s: string) => void } } = { m(x) { x.length; }, n: { deep: s => s.toFixed() } };
const sat = { a: (x) => x } satisfies { a: (x: number) => number };
const cfree = [1, 2].map(x => x.length);
