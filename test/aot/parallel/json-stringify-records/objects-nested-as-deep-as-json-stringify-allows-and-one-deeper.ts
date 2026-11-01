// JSON.stringify takes 40,000 objects and lists inside one another and throws a RangeError at one more, also where the compiler writes the serializer.
type Chain = { next: Chain | null; n: number };
type Tree = { kids: Tree[] };
class Link {
  constructor(public inner: Link | null) {}
}
function objects(levels: number): unknown { let value: unknown = 1; for (let i = 0; i < levels; i++) value = { a: value }; return value; }
function byTurns(levels: number): unknown { let value: unknown = 1; for (let i = 0; i < levels; i++) value = i & 1 ? [value] : { a: value }; return value; }
function chain(levels: number, innermost: Chain | null = null): Chain | null { let value = innermost; for (let i = 0; i < levels; i++) value = { next: value, n: i }; return value; }
function tree(nodes: number): Tree { let value: Tree = { kids: [] }; for (let i = 1; i < nodes; i++) value = { kids: [value] }; return value; }
function links(levels: number): Link | null { let value: Link | null = null; for (let i = 0; i < levels; i++) value = new Link(value); return value; }
// Objects that no code of this program has made: a serializer made for Chain hands them to the run time.
const parsed = (levels: number) => JSON.parse('{"n":0,"next":'.repeat(levels) + "null" + "}".repeat(levels)) as Chain;

function attempt(name: string, run: () => unknown) {
  try {
    const made = run();
    console.log(name, typeof made, typeof made === "string" ? made.length : made);
  } catch (error) {
    console.log(name, error instanceof RangeError, (error as Error).name + ": " + (error as Error).message);
  }
}
for (const levels of [40_000, 40_001]) {
  attempt("objects " + levels, () => JSON.stringify(objects(levels)));
  attempt("by turns " + levels, () => JSON.stringify(byTurns(levels)));
  attempt("a chain " + levels, () => JSON.stringify(chain(levels)));
  attempt("instances " + levels, () => JSON.stringify(links(levels)));
  attempt("a chain in an object that is written here " + levels, () => JSON.stringify({ q: "x", deep: chain(levels - 1) }));
  attempt("a chain in two lists that are written here " + levels, () => JSON.stringify([[chain(levels - 2)]]));
  attempt("a chain over objects from elsewhere " + levels, () => JSON.stringify(chain(levels - 20, parsed(20))));
  attempt("objects from elsewhere over nothing " + levels, () => JSON.stringify(chain(20, parsed(levels - 20))));
}
// A node is an object and its list, so a tree has an even number of levels, and the innermost is a list without elements.
attempt("a tree 40000", () => JSON.stringify(tree(20_000)));
attempt("a tree 40002", () => JSON.stringify(tree(20_001)));
attempt("a tree in a list 39999", () => JSON.stringify([tree(19_999)]));
attempt("a tree in a list 40001", () => JSON.stringify([tree(20_000)]));
attempt("far deeper, a chain", () => JSON.stringify(chain(300_000)));
attempt("far deeper, a tree", () => JSON.stringify(tree(150_000)));
