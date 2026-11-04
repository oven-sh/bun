// The same in a function that gets the record as a parameter, in a loop, with a collection between the reads.
type Options = { name: string; isExpected?: (e: unknown) => boolean };
function one(k: number): Options { let n = k; return { name: "a", isExpected: e => { n++; return n > 1; } }; }
function two(): Options { return { name: "b" }; }
function ask(options: Options): string {
  const first = options.isExpected;
  const has = "isExpected" in options;
  Bun.gc(true);
  const second = options.isExpected;
  return typeof first + ":" + has + ":" + (first === second) + ":" + Object.keys(options).length;
}
const said = new Set<string>();
for (let i = 0; i < 40; i++) said.add(ask(i & 1 ? one(i) : two()));
console.log([...said].sort().join(" "));
