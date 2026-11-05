// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function show(value: unknown): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null)
    return Array.isArray(value) ? "[" + value.join() + "]" : Object.prototype.toString.call(value);
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
function nameOfError(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).name;
  }
}
type Pair = [number, string];
type Row = [number, ...string[]];
type Maybe = [number, string?];
function lengthOf(pair: Pair): number {
  return pair.length;
}
function lengthOfRow(row: Row): number {
  return row.length;
}
function lengthOfMaybe(maybe: Maybe): number {
  return maybe.length;
}
function lengthOfFixed(fixed: readonly [number, number]): number {
  return fixed.length;
}
function isLong(pair: Pair): boolean {
  return (pair.length as number) > 2;
}
function joined(pair: Pair): string {
  return pair.map(String).join("+");
}
function last(pair: Pair): unknown {
  return pair.at(-1);
}
function second(pair: Pair): unknown {
  return pair[1];
}
function at(pair: Pair, index: number): unknown {
  return pair[index];
}
function copy(pair: Pair): unknown[] {
  return [...pair];
}
function parts(pair: Pair): string {
  const [a, b] = pair;
  return a + "/" + b;
}
function describe(label: string, pair: Pair): void {
  attempt(label + ", length", () => lengthOf(pair) + " " + isLong(pair));
  attempt(label + ", map", () => joined(pair));
  attempt(label + ", at", () => last(pair));
  attempt(label + ", elements", () => [show(second(pair)), show(at(pair, 0)), show(at(pair, 2))].join());
  attempt(label + ", spread", () => copy(pair));
  attempt(label + ", pattern", () => parts(pair));
  attempt(label + ", as an object", () =>
    [Array.isArray(pair), pair instanceof Array, JSON.stringify(pair), Object.keys(pair).join()].join(" "),
  );
}
const pair: Pair = [1, "one"];
describe("as created", pair);
(pair as any).push("more");
describe("after push", pair);
(pair as any).length = 1;
describe("after a shorter length", pair);
(pair as any)[4] = "far";
describe("after a store past the end", pair);
(pair as any).length = 0;
describe("emptied", pair);

const hidden: Pair = [2, "two"];
(hidden as any).map = function () {
  return ["own map"];
};
Object.defineProperty(hidden, "at", { value: () => "own at" });
describe("with its own map and at", hidden);

const reparented: Pair = [3, "three"];
Object.setPrototypeOf(
  reparented,
  Object.create(Array.prototype, {
    map: {
      value() {
        return ["map from the new prototype"];
      },
    },
    at: {
      value() {
        return "at from the new prototype";
      },
    },
  }),
);
describe("with a different prototype", reparented);

const orphan: Pair = [4, "four"];
Object.setPrototypeOf(orphan, null);
attempt("with a null prototype, length", () => lengthOf(orphan));
attempt("with a null prototype, map", () => joined(orphan));
attempt("with a null prototype, elements", () => [show(second(orphan)), show(at(orphan, 0))].join());

class Pairs extends Array<number | string> {
  override map(): any {
    return ["map of the subclass"];
  }
}
describe("an Array subclass instance", Pairs.from([5, "five"]) as unknown as Pair);
describe("frozen", Object.freeze([6, "six"]) as unknown as Pair);
describe("an array-like object", { 0: 7, 1: "seven", length: 2 } as unknown as Pair);

const row: Row = [1, "a", "b"];
attempt("a tuple with a rest element", () => lengthOfRow(row));
row.push("c");
attempt("a tuple with a rest element, after push", () => lengthOfRow(row));
const maybe: Maybe = [1];
attempt("a tuple with an optional element", () => lengthOfMaybe(maybe));
maybe[1] = "there";
attempt("a tuple with an optional element, filled", () => lengthOfMaybe(maybe));
const fixed = [1, 2] as const;
attempt("a read-only tuple", () => lengthOfFixed(fixed));
(fixed as any).push(3);
attempt("a read-only tuple, after push", () => lengthOfFixed(fixed));
export {};
