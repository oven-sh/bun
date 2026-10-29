// Fields that compiled code fills with small whole numbers, with undefined, with null or not at all. Text evaluated at run time reads them and asks for them, then gives them whole numbers of every size, fractions and nothing, and reads again.
class OrUndefined { text: string; fraction: number; value: number | undefined; constructor(i: number) { this.text = "t" + i; this.fraction = i + 0.5; this.value = i & 1 ? undefined : i; } }
class OrNull { text: string; fraction: number; value: number | null; constructor(i: number) { this.text = "t" + i; this.fraction = i + 0.5; this.value = i & 1 ? null : i; } }
class OrAbsent { text: string; fraction: number; value?: number; constructor(i: number) { this.text = "t" + i; this.fraction = i + 0.5; if (i & 1) this.value = i; } }
const rows = [new OrUndefined(1), new OrUndefined(2), new OrUndefined(-4), new OrNull(1), new OrNull(2), new OrNull(-4), new OrAbsent(1), new OrAbsent(2), new OrAbsent(-3)];
// No build knows the text.
const atRunTime = (text: string) => text + String(process.argv.length).slice(9);
const describe = new Function("rows", atRunTime(`
  const lines = [];
  for (let turn = 0; turn < 4; turn++)
    for (const r of rows)
      lines.push([r.text, r.value, typeof r.value, "value" in r, Object.is(r.value, -0), r.value === undefined, r.value + 1, r.fraction].join(" "));
  return lines;`));
const store = new Function("rows", "value", atRunTime(`for (const r of rows) r.value = value;`));
const remove = new Function("rows", atRunTime(`for (const r of rows) delete r.value;`));
function show(what: string) {
  const lines: string[] = describe(rows);
  console.log(what, lines.length, new Set(lines).size);
  console.log(lines.slice(0, rows.length).join("\n"));
}
show("as made");
for (const value of [0, 1, -1, 1000, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 1099511627776, -1099511627776, 9007199254740991, -9007199254740991, 4611686018427387904, 4611967493404098560, 4612248968380809216, 1e300, 0.5, -0, NaN, Infinity]) {
  store(rows, value);
  show(String(value));
}
store(rows.slice(0, 3), undefined);
store(rows.slice(3, 6), null);
remove(rows.slice(6));
show("nothing");
store(rows, 7);
show("seven");
