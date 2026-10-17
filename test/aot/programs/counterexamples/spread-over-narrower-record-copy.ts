// `{ ...w, ...s }`: the second spread may store a string where the object behind w holds a number.
declare const console: { log(...a: unknown[]): void };
const n = { v: 1 }, w: { v: number | string } = n, s: { v: number | string } = { v: "s" };
console.log(JSON.stringify({ ...w, ...s }));
