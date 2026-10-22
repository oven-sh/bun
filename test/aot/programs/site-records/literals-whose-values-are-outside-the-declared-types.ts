// An object literal is written for a declared type, and the values that arrive for its fields are of other types. The object holds what it was given, and typed reads hand it on unchanged.
interface Row {
  id: number;
  ratio: number;
  done: boolean;
  title: string;
  tags: string[];
  owner: { name: string };
  note?: string;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return JSON.stringify(value, (_key, member) => (typeof member === "object" || typeof member === "string" ? member : show(member)));
  return String(value);
}

function rowOf(id: number, ratio: number, done: boolean, title: string, tags: string[], owner: { name: string }): Row {
  return { id, ratio, done, title, tags, owner };
}
function rowOfOne(value: any): Row {
  return { id: value, ratio: value, done: value, title: value, tags: value, owner: value, note: value };
}
function rowWithConstants(value: any): Row {
  return { id: 1, ratio: value, done: true, title: "constant", tags: value, owner: { name: value } };
}
function readAll(row: Row): string {
  return [row.id, row.ratio, row.done, row.title, row.tags, row.owner, row.note].map(show).join(" ");
}
function kinds(row: Row): string {
  return [typeof row.id, typeof row.ratio, typeof row.done, typeof row.title, typeof row.tags, typeof row.owner, typeof row.note].join(" ");
}
function copyOf(row: Row): Row {
  return { id: row.id, ratio: row.ratio, done: row.done, title: row.title, tags: row.tags, owner: row.owner, note: row.note };
}

const values: unknown[] = [undefined, null, 0, -0, 3, 2 ** 31, -(2 ** 31), 2 ** 53, 0.1, NaN, -Infinity, true, false, "", "text", 9n, Symbol.for("s"), [], ["t"], {}, { name: "n" }, () => 0];

console.log("honest:", readAll(rowOf(1, 0.5, true, "t", ["a"], { name: "o" })), Object.keys(rowOf(1, 0.5, true, "t", ["a"], { name: "o" })).join());
for (const value of values) {
  const loose = value as any;
  const one = rowOfOne(loose);
  console.log(show(value) + ":", readAll(one), "|", kinds(one));
  console.log("  by parameters:", readAll(rowOf(loose, loose, loose, loose, loose, loose)));
  console.log("  beside constants:", readAll(rowWithConstants(loose)));
  console.log("  copied:", readAll(copyOf(one)), readAll(copyOf(copyOf(one))) === readAll(one), Object.keys(one).join() === Object.keys(copyOf(one)).join());
}
console.log("honest:", readAll(rowOf(1, 0.5, true, "t", ["a"], { name: "o" })));

export {};
