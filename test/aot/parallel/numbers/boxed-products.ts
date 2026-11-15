const list: number[] = [0, 3, -5, 46341, 2147483647], odd: number[] = [0, -0, 0.5, NaN, -7], seen = new Map<any, any>();
const name = (x: unknown) => (Object.is(x, -0) ? "-0" : String(x));
function put(xs: number[], i: number, j: number): void { seen.set(xs[i] * xs[j], i); seen.set("k" + j, xs[i] * 3); }
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) put(list, i, j);
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) put(odd, i, j);
console.log([...seen].map(entry => entry.map(name).join("=")).join(" "));
