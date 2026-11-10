// STATISTIC: CopiesThatAreDefinitionsOneByOne >= 1
// The rest of a pattern has a layout by the written type of the parameter; the records that are handed over pass for that type and bring a name more: the copy is its definitions, less the names that the pattern has taken.
function show(o: any): string { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(o[k])).join(",") + "#" + ("a" in o); }
type Narrow = { a: number; b: string };
type Wide = { a: number; b: string; c: boolean; d: number };
function born(a: number, b: string, c: boolean, d: number): Wide { return { a, b, c, d }; }
function first({ a, ...rest }: Narrow) { return rest; }
function second({ b, ...rest }: Narrow) { return rest; }
const wide: Wide[] = [born(1, "x", true, 5), born(2, "y", false, 6), { d: 7, c: true, b: "z", a: 3 }];
const lines: string[] = [];
for (let round = 0; round < 2; round++)
  for (let i = 0; i < wide.length; i++) lines.push(show(first(wide[i])) + " " + show(second(wide[i])));
console.log(lines.join(" | "));
