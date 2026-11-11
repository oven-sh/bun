// A field that holds an array of strings or numbers is written in place. Whatever else it holds is written as plain Bun writes it.
interface Row {
  id: number;
  tags: unknown[];
  name: string;
}

class Tags extends Array<string> {}

const withHole: unknown[] = ["a", , "b"];
const withProperty: unknown[] = ["a"];
(withProperty as any).extra = 1;
const withToJSON: unknown[] = ["a"];
(withToJSON as any).toJSON = () => "own";
const subclass = new Tags();
subclass.push("a", "b");
const long = Array.from({ length: 3000 }, (_, i) => (i % 3 ? "element " + i : i * 1.5));
const rope = "left ".repeat(2) + process.argv.length;

const arrays: unknown[][] = [
  [],
  ["a"],
  ["a", "b", "c"],
  ["quote \" and \\ and \n"],
  ["é", "ÿ"],
  ["中", "a"],
  ["\ud800"],
  [rope + "x", "y"],
  ["z".repeat(63), "z".repeat(64), "z".repeat(500)],
  [1, 2, -3, 2147483647, -2147483648],
  [1.5, -0, 0, 1e21, 1e-7, 123456789.125],
  [NaN, Infinity, -Infinity, 1],
  [true, false, null, undefined],
  ["a", 1, true, null, 2.5],
  [undefined],
  ["a", { deep: 1 }],
  [["nested"], []],
  ["a", () => 1, Symbol("s")],
  [new Date(0), "a"],
  [Object("boxed"), Object(1)],
  Object.freeze(["frozen", 1]) as unknown[],
  withHole,
  withProperty,
  withToJSON,
  subclass,
  long,
];

for (let round = 0; round < 3; round++) {
  const rows: Row[] = arrays.map((tags, id) => ({ id, tags, name: "row " + id }));
  const text = JSON.stringify(rows);
  if (round < 2) continue;
  console.log(text.length, text.slice(0, 1600));
  for (const row of rows) {
    const one = JSON.stringify(row);
    console.log(row.id, one.length, one.slice(0, 120), JSON.stringify(row, null, 1).length);
  }
}

const big: Row = { id: 1, tags: ["a", 1n], name: "big" };
const cyclic: Row = { id: 2, tags: ["a"], name: "cyclic" };
cyclic.tags.push(cyclic);
for (const row of [big, cyclic]) {
  try {
    console.log(JSON.stringify([{ id: 0, tags: ["first"], name: "n" }, row]));
  } catch (error) {
    console.log((error as Error).name);
  }
}
