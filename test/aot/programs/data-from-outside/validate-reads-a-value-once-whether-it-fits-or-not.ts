// validate<T> reads a getter once, for a value that fits and for a value that is refused, whichever code validates T: a record, a union told apart by a tag, a union whose arms are tried one after the other, and a union that contains itself, which the library validates.
import { validate } from "bun:bundle";

type Point = { x: number; y: number };
type Tagged = { kind: "a"; a: number } | { kind: "b"; b: Point };
type Untagged = { a: number; b: string } | { a: number; c: string };
type Nested = { below: Nested | null; k: number } | { below: Nested | null; k: string };
type Rows = { rows: Rows[]; k: number } | { rows: Rows[]; k: string };
type Holder = { tree: Rows; n: number };

let reads = 0;
function counted<T>(value: T): T {
  reads++;
  return value;
}
function row(label: string, run: () => unknown): void {
  reads = 0;
  let said: string;
  try {
    said = JSON.stringify(run());
  } catch (error: any) {
    said = error.issues ? "refused: " + error.issues.map((issue: any) => issue.path.join(".") + " " + issue.code).join("; ") : String(error);
  }
  console.log(label + ": " + said + ", read " + reads);
}

row("a record that fits", () => validate<Point>({ x: 1, get y() { return counted(2); } }));
row("a record that is refused", () => validate<Point>({ x: 1, get y() { return counted("two"); } }));
row("a tag that fits", () => validate<Tagged>({ get kind() { return counted("a"); }, a: 1 }));
row("a tag of no arm", () => validate<Tagged>({ get kind() { return counted("c"); }, a: 1 }));
row("a tag whose arm refuses", () => validate<Tagged>({ get kind() { return counted("a"); }, a: "one" }));
row("the second arm fits", () => validate<Untagged>({ get a() { return counted(1); }, c: "c" }));
row("no arm fits", () => validate<Untagged>({ get a() { return counted(1); }, d: "d" }));
row("a union that contains itself, fits", () => validate<Nested>({ below: null, get k() { return counted("s"); } }));
row("a union that contains itself, refused", () => validate<Nested>({ below: null, get k() { return counted(true); } }));
row("the same one level down, fits", () => validate<Nested>({ below: { below: null, get k() { return counted(1); } }, k: "s" }));
row("the same one level down, refused", () => validate<Nested>({ below: { below: null, get k() { return counted(null); } }, k: "s" }));
row("a union that holds arrays of itself, fits", () => validate<Rows>({ rows: [], get k() { return counted("s"); } }));
row("a union that holds arrays of itself, refused", () => validate<Rows>({ rows: [], get k() { return counted(true); } }));
row("the same one level down, fits", () => validate<Rows>({ rows: [{ rows: [], get k() { return counted(1); } }], k: "s" }));
row("the same one level down, refused", () => validate<Rows>({ rows: [{ rows: [], get k() { return counted(null); } }], k: "s" }));

function holder(n: unknown, k: unknown): unknown {
  const parsed = JSON.parse('{"tree":null,"n":null}');
  parsed.tree = { rows: [], get k() { return counted(k); } };
  parsed.n = n;
  return parsed;
}
row("such a union below plain data, fits", () => validate<Holder>(holder(1, "s")));
row("such a union below plain data, a later member is refused", () => validate<Holder>(holder("no", "s")));
row("such a union below plain data, refused itself", () => validate<Holder>(holder(1, true)));
