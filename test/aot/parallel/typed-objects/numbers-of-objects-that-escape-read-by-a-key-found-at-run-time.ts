// The fields are numbers by their type, the objects go where nobody follows them, and no code reads the fields by name. Whatever can be in a number comes back as it was stored, by any way of asking, and after stores by key.
type Row = { whole: number; part: number };
const values = [
  0,
  -0,
  1,
  -1,
  2147483647,
  2147483648,
  -2147483649,
  9007199254740992,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  5e-324,
  1.7976931348623157e308,
];
const rows: Row[] = values.map((value, index) => ({ whole: index * 3, part: value }));
const store = globalThis as any;
store.rows = rows;
const seen = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
const lines: string[] = [];
for (const key of store.argvKeys ?? ["whole", "part", "missing", "toString"]) {
  let sum = 0;
  const read: string[] = [];
  for (const row of store.rows) {
    const value = row[key];
    read.push(typeof value === "function" ? "function" : seen(value));
    sum = (sum + (typeof value === "number" ? value : 0)) | 0;
  }
  lines.push(key + ": " + read.join(" ") + " | " + sum);
}
lines.push("json: " + JSON.stringify(store.rows[8]));
lines.push(
  "entries: " +
    Object.entries(store.rows[1])
      .map(([key, value]) => key + "=" + seen(value))
      .join(","),
);
lines.push("descriptor: " + seen(Object.getOwnPropertyDescriptor(store.rows[1], "part")!.value));
const other = store.rows[3];
other[["pa", "rt"].join("")] = "text";
other[["who", "le"].join("")] = { object: true };
lines.push("other kinds: " + typeof other.part + " " + typeof other.whole + " " + seen(store.rows[4].part));
delete store.rows[5].part;
lines.push("deleted: " + seen(store.rows[5].part) + " " + ("part" in store.rows[5]));
Object.freeze(store.rows[6]);
lines.push("frozen: " + Reflect.set(store.rows[6], "part", 7) + " " + seen(store.rows[6].part));
lines.push("copy: " + seen({ ...store.rows[1] }.part) + " " + seen(Object.assign({}, store.rows[10]).part));
console.log(lines.join("\n"));
