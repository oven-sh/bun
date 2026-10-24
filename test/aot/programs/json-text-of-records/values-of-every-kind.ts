const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function text(value: unknown, indent?: number): string | undefined {
  return JSON.stringify(leak(value), null, indent);
}
interface Flags { on: boolean; maybe?: boolean; orNull: boolean | null; orUndefined: boolean | undefined }
for (const on of [true, false]) {
  const rows: Flags[] = [{ on, orNull: on, orUndefined: on }, { on, maybe: on, orNull: null, orUndefined: undefined }, { on, maybe: !on, orNull: !on, orUndefined: !on }];
  for (const row of rows) console.log(text(row));
  console.log(text(rows), text(rows, 1));
}
interface Mixed { anything: unknown; label: string }
const date = new Date(86400000 * 365.25 * 30);
const kinds: unknown[] = [undefined, null, true, false, 0, -0, 7, 1.25, NaN, "s", "", Symbol("s"), () => 1, function named() {}, class K {}, [], [1, "a", null, undefined, () => 1, Symbol.iterator], {}, { x: 1 },
  date, new Date(NaN), new Map([[1, 2]]), new Set([1]), /x/g, new Error("e"), new Number(5), new String("boxed"), new Boolean(false), Object(Symbol("boxed")), new Uint8Array([1, 2]), Object.create(null), Object.create({ inherited: 1 }), [, 1, , 2], Array(3)];
for (const anything of kinds) {
  const row: Mixed = { anything, label: "l" };
  console.log(text(row), text([row, row]), text({ first: row, second: [row] }));
}
for (const big of [1n, Object(2n)]) {
  try {
    console.log(text({ anything: big, label: "l" } satisfies Mixed));
  } catch (error) {
    console.log((error as Error).name);
  }
  try {
    console.log(text([{ anything: 1, label: "l" }, { anything: 2, label: "l" }, { anything: big, label: "l" }] satisfies Mixed[]));
  } catch (error) {
    console.log((error as Error).name);
  }
}
interface Node { value: number; next: Node | null; children: Node[] }
function chain(depth: number): Node {
  let node: Node = { value: depth, next: null, children: [] };
  for (let i = depth - 1; i >= 0; i--) node = { value: i, next: node, children: i % 3 ? [] : [{ value: -i, next: null, children: [] }, { value: -i - 1, next: null, children: [] }] };
  return node;
}
console.log(text(chain(12)));
console.log(text(chain(4), 2));
const cyclic: Node = { value: 1, next: null, children: [] };
cyclic.children.push({ value: 2, next: cyclic, children: [] });
try {
  text(cyclic);
} catch (error) {
  console.log((error as Error).name);
}
try {
  console.log(text(chain(200000))!.length);
} catch (error) {
  console.log((error as Error).name);
}
export {};
