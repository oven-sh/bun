type One = { a: number };
function written(one: One, z: number) { return { ...one, z }; }
(globalThis as any).keep = written;
const widen: typeof written = (globalThis as any).keep;
(globalThis as any).literal = [{ a: 0, z: 0 }, { a: 0, b: 0, z: 0 }, { a: 0, b: 0, c: 0, z: 0 }];
const first: One = { a: 1 };
const second = { a: 2, b: 3 };
const third = { a: 4, b: 5, c: 6 };
const texts = new Set<string>();
for (let i = 0; i < 3000; i++) texts.add(JSON.stringify(widen([first, second, third][i % 3], i & 1)));
console.log([...texts].join(" "));
