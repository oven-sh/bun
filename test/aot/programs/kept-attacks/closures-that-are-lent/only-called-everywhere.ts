// Closures that are lent: only called everywhere. It prints what plain Bun prints.
type F = () => number;
const make = (): F => () => 24; let sum = 0; const kept: F[] = [];
for (let i = 0; i < 3000; i++) { const f = make(); kept[i & 7] = f; sum += f() + kept[(i + 1) & 7 & (i > 8 ? 7 : 0)](); }
const table = { first: () => 1, second: () => 2, third: () => 3 };
const use = (t: typeof table) => t.first() + t.second() + t.third();
for (let i = 0; i < 3000; i++) sum += use({ first: () => 1, second: () => 2, third: () => 3 });
console.log(sum, use(table));
