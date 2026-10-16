// What a generic function makes with a spread is one object, wherever it has lain in between: a store through one name is seen through the other.
interface R { a: number; b: string }
const kept: { g: number }[] = [];
function wide<T extends object>(r: T, i: number): T & { g: number } { const box = new Set([{ ...r, g: i }]); const made = [...box][0]; kept.push(made); return made }
const w = wide<R>({ a: 1, b: "x" }, 7);
w.g = 8;
console.log((w as object) === kept[0], kept[0].g, w.g, w.a, w.b, Object.keys(w).join());
