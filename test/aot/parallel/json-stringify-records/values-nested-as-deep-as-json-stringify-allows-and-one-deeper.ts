// JSON.stringify takes 40,000 lists inside one another and throws a RangeError at one more, however much stack the thread has.
class Said {
  constructor(public inner: Said | null) {}
  toJSON() {
    return { said: this.inner };
  }
}
function lists(levels: number): unknown { let value: unknown = 1; for (let i = 0; i < levels; i++) value = [value]; return value; }
function said(levels: number): Said | null { let value: Said | null = null; for (let i = 0; i < levels; i++) value = new Said(value); return value; }

function attempt(name: string, run: () => unknown) {
  try {
    const made = run();
    console.log(name, typeof made, typeof made === "string" ? made.length : made);
  } catch (error) {
    console.log(name, error instanceof RangeError, (error as Error).name + ": " + (error as Error).message);
  }
}
for (const levels of [40_000, 40_001]) {
  attempt("lists " + levels, () => JSON.stringify(lists(levels)));
  attempt("in an object that is written here " + levels, () => JSON.stringify({ q: "x", deep: lists(levels - 1) }));
  attempt("beside a wide text " + levels, () => JSON.stringify([lists(levels - 1), "中"]));
  attempt("through toJSON " + levels, () => JSON.stringify(said(levels)));
  attempt("a replacer that is a function " + levels, () => JSON.stringify(lists(levels), (_key, value) => value));
}
attempt("far deeper, lists", () => JSON.stringify(lists(300_000)));

const textOfLists = (levels: number) => "[".repeat(levels) + "]".repeat(levels);
const textOfObjects = (levels: number) => '{"a":'.repeat(levels) + "1" + "}".repeat(levels);
for (const levels of [4_500, 4_501]) {
  attempt("a reviver over lists " + levels, () => typeof JSON.parse(textOfLists(levels), (_key, value) => value));
  attempt("a reviver over objects " + levels, () => typeof JSON.parse(textOfObjects(levels), (_key, value) => value));
}
attempt("no reviver, lists", () => typeof JSON.parse(textOfLists(60_000)));
attempt("no reviver, objects", () => typeof JSON.parse(textOfObjects(60_000)));
