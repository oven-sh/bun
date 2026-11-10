// STATISTIC: ObjectSpreadsExpandedToDefines >= 1
// `const { a, ...rest } = source`: the copy leaves out the names that the pattern has taken: in a loop, out of a default in sight, with a name that the source has not, with all its names, with a computed one.
function show(o: any): string { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(o[k])).join(",") + "#" + ("a" in o); }
type Props = { a: number; b: string; c: boolean };
function born(a: number, b: string, c: boolean): Props { return { a, b, c }; }
const key = (text: string): any => JSON.parse(JSON.stringify(text));
function put(o: any, k: any, v: any) { o[k] = v; }
const grown = born(7, "g", true); put(grown, key("extra"), "x");
const turned: Props = { c: false, a: 8, b: "t" };
const sources: Props[] = [born(1, "x", true), born(2, "y", false), grown, turned];
function first({ a, ...rest }: Props) { return rest; }
function middle({ b, ...rest }: Props) { return rest; }
function two({ a, c, ...rest }: Props) { return rest; }
function all({ a, b, c, ...rest }: Props) { return rest; }
function absent({ z, ...rest }: any) { return rest; }
function computed(source: Props, name: "a" | "b") { const { [name]: taken, ...rest } = source; return rest; }
function byDefault({ a, ...rest }: any = { a: 1, q: 2 }) { return rest; }
function onto(base: any, { a, ...rest }: Props) { return { ...base, ...rest }; }
const lines: string[] = [];
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    lines.push([i, show(first(s)), show(middle(s)), show(two(s)), show(all(s)), show(absent(s)), show(computed(s, i & 1 ? "a" : "b")), show(byDefault()), show(byDefault(s)), show(onto({ a: "kept", z: 0 }, s))].join(" | "));
  }
}
for (const { a, ...rest } of sources) lines.push(a + " " + show(rest));
console.log(lines.join("\n"));
