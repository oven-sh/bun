// An array literal of five and more elements is made from a list of its values, in code that runs often and in code that runs once.
function given<T>(text: string): T { return JSON.parse(text) as T; }
const g = given<{ n: number; s: string; o: { a: number }; f: number; u?: number }>('{"n":3,"s":"x","o":{"a":1},"f":0.5}');
function five(a: unknown, b: unknown, c: unknown, d: unknown, e: unknown): unknown[] { return [a, b, c, d, e]; }
function six(a: unknown): unknown[] { return [a, g.n, g.s, g.o, g.f, g.u]; }
function seven(): number[] { return [g.n, g.n + 1, g.n + 2, g.n + 3, g.n + 4, g.n + 5, g.n + 6]; }
function eightFractions(): number[] { return [g.f, g.f * 2, g.f * 3, g.f * 4, g.f * 5, g.f * 6, g.f * 7, g.f * 8]; }
function mixed(): (number | string | null | undefined | boolean | object)[] { return [g.n, g.s, null, undefined, true, g.o, -0, NaN, g.f, [g.n], () => g.n]; }
function long(x: number): number[] {
  return [x, x + 1, x + 2, x + 3, x + 4, x + 5, x + 6, x + 7, x + 8, x + 9, x + 10, x + 11, x + 12, x + 13, x + 14, x + 15, x + 16, x + 17, x + 18, x + 19, x + 20, x + 21, x + 22, x + 23, x + 24, x + 25, x + 26, x + 27, x + 28, x + 29, x + 30, x + 31, x + 32];
}
function show(list: unknown[]): string { return list.length + ":" + list.map(value => typeof value === "function" ? "fn" : Object.is(value, -0) ? "-0" : JSON.stringify(value) ?? String(value)).join(","); }
console.log(show(five(1, "b", null, g.o, 2.5)), show(six(undefined)), show(seven()), show(eightFractions()), show(mixed()), show(long(g.n)));

// They are arrays like any other: they grow, shrink, take holes and other kinds of elements.
const list = five(1, 2, 3, 4, 5); list.push(6, 7, 8); list[12] = "far"; console.log(show(list), 9 in list, list.indexOf("far"));
const even = six(0); even.push("seventh"); console.log(show(even), even.length);
const numbers = seven(); numbers.push(0.25); numbers.unshift(-1); numbers.length = 5; console.log(show(numbers), numbers.reduce((sum, value) => sum + value, 0));
console.log(Array.isArray(mixed()), Object.keys(seven()).join(), show([...eightFractions(), ...seven()]), show(long(0).slice(30)), show(long(0).filter(value => value % 8 === 0)));
const [first, , third, ...others] = long(10); console.log(first, third, others.length, others[29]);

// Each evaluation makes its own array.
const made = [seven(), seven()]; made[0][0] = 99; console.log(made[0][0], made[1][0], made[0] === made[1]);

// Many of them, kept alive while the collector runs.
const kept: unknown[][] = [];
for (let i = 0; i < 20000; i++) { const array = i % 3 ? five(i, i + 1, "s" + i, g.o, i / 2) : long(i); if (i % 7 === 0) kept.push(array); }
Bun.gc(true);
let sum = 0; for (const array of kept) sum += array.length + (array[0] as number);
console.log(kept.length, sum, show(kept[1]), show(kept[kept.length - 1].slice(0, 5)));
