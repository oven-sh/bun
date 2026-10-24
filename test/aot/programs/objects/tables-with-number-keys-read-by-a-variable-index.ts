// A literal with numbers for keys is a table: it is read under an index that only the run knows. What the table lacks, what was deleted, redefined or inherited has to come out as in any object.
const enum Kind { First = 1, Second, Third, Fifth = 5, Ninth = 9 }
type Handler = (x: number) => string;
const table: Record<number, Handler> = {
  [Kind.First]: x => "first " + x,
  [Kind.Second]: x => "second " + x,
  [Kind.Third]: function third(x) { return "third " + x; },
  [Kind.Fifth]: x => "fifth " + x,
  [Kind.Ninth]: x => "ninth " + x,
};
function dispatch(t: Record<number, Handler>, kind: number, x: number): string {
  const handler = t[kind];
  return handler === undefined ? "none" : handler(x);
}
function line(mark: string, t: Record<number, any>, indices: number[]): void {
  console.log(mark, indices.map(i => { const v = t[i]; return typeof v === "function" ? v(i) : String(v); }).join(" | "));
}
const indices = [0, 1, 2, 3, 4, 5, 6, 9, 10, 100, -1, 1.5, 4294967295, 4294967294, 2147483648, NaN];
let text = "";
for (let round = 0; round < 3; round++) for (const i of indices) text += dispatch(table, i, round) + ";";
console.log(text);
line("as written", table, indices);

const values: Record<number, unknown> = { 0: 0, 1: 1.5, 2: "two", 3: null, 4: undefined, 5: true, 7: { seven: 7 } };
line("values", values, indices);
const integers: Record<number, number> = { 0: 10, 1: 11, 2: 12 };
line("integers", integers, indices);
const doubles: Record<number, number> = { 0: 0.5, 1: 1.5, 2: -0 };
line("doubles", doubles, indices);
console.log(Object.is(doubles[indices[2]], -0));

delete (table as any)[2];
line("one deleted", table, indices);
Object.defineProperty(table, 3, { get() { return (x: number) => "getter " + x; }, configurable: true });
line("one is a getter", table, indices);
table[6] = x => "sixth " + x;
table[100] = x => "hundredth " + x;
line("two added", table, indices);
Object.setPrototypeOf(table, { 4: (x: number) => "inherited " + x, 2: (x: number) => "inherited where deleted " + x });
line("a prototype with indices", table, indices);
Object.freeze(table);
line("frozen", table, indices);

const sparse: Record<number, string> = { 1: "one", 1000000: "a million" };
line("far apart", sparse, [0, 1, 2, 999999, 1000000, 1000001]);
const mixed: Record<string | number, string> = { a: "a", 1: "one", b: "b", 0: "zero" };
line("with names", mixed, [0, 1, 2]);
console.log(Object.keys(mixed).join(), mixed["1"], mixed[("0" + "").length - 1]);
const empty: Record<number, string> = {};
line("empty", empty, [0, 1]);
empty[0] = "now";
line("no longer", empty, [0, 1]);
