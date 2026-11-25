const said: unknown[] = [];
function outside<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function hidden<T>(value: T): T { return ({ value } as any)[JSON.parse('"value"')]; }
type Entry = { time: number; value: number };
const here: Entry[] = Array.from({ length: 16 }, (_, i) => ({ time: i * 10, value: i + 0.5 })); const there = outside(here);
function pairs(a: Entry[], b: Entry[], join: (x: Entry, y: Entry) => number) { let s = 0; for (let i = 0; i < a.length; i++) s += join(a[i]!, b[i]!); return s; }
said.push(pairs(here, there, (x, y) => x.time * y.value), pairs(there, here, (x, y) => x.time * y.value), pairs(there, there, (x, y) => x.time - y.value), pairs(here, here, (x, y) => x.time - y.value));
console.log(said.join(" | "));
export {};
