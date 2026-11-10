// STATISTIC: CopiesThatAreDefinitionsOneByOne >= 1
// The record stands in sight under a narrower written type: the rest has that type's layout, the record brings a name more: the copy is its definitions, less the name that the pattern has taken.
function show(o: any): string { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(o[k])).join(",") + "#" + ("a" in o); }
type Narrow = { a: number; b: string };
function once(n: number) { const wide = { a: n, b: "x", c: true }; const narrow: Narrow = wide; const { a, ...rest } = narrow; return a + " " + show(rest); }
function other(n: number) { const wide = { c: false, b: "y", a: n }; const narrow: Narrow = wide; const { b, ...rest } = narrow; return b + " " + show(rest); }
console.log(once(JSON.parse("1")), other(JSON.parse("2")));
const lines: string[] = [];
for (let i = 0; i < 3; i++) lines.push(once(i) + " " + other(i));
console.log(lines.join(" | "));
