// A store that expects an object gets null, undefined and primitive values. The right side runs first, then the store throws, or finds a setter on the wrapper's prototype chain. Nothing is created anywhere.
class Target {
  field = 1;
  declare extra?: number;
}

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function noted(value: number): number {
  trail.push("right side " + value);
  return value;
}
function store(target: Target): void {
  target.field = noted(2);
}
function create(target: Target): void {
  target.extra = noted(3);
}
function update(target: Target): number {
  return (target.field += noted(4));
}
function increment(target: Target): number {
  return target.field++;
}
function storeLength(target: { length: number }): void {
  target.length = noted(0);
}
function look(mark: string, value: unknown): void {
  const target = value as Target;
  console.log(mark + ":", attempt(() => store(target)), attempt(() => create(target)), attempt(() => update(target)), attempt(() => increment(target)), attempt(() => storeLength(value as { length: number })), trail.splice(0).join(";"));
}

look("null first", null);
look("honest", new Target());
look("undefined", undefined);
look("zero", 0);
look("fraction", 0.5);
look("not a number", NaN);
look("true", true);
look("false", false);
look("honest", new Target());
look("empty text", "");
look("text", "text");
look("joined text", ["a", "b"].join("-") + "c".repeat(30));
look("symbol", Symbol("s"));
look("bigint", 5n);
look("large bigint", 2n ** 100n);
look("null", null);
look("honest", new Target());
console.log((5 as any).field, ("text" as any).extra, "text".length);

export {};
