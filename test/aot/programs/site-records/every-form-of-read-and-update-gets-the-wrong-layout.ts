// Every syntactic form that reads or updates a field: patterns with defaults, optional chains, compound and logical assignments, increments, `in`, `delete`, `typeof`, spreads, enumerations. Each gets the expected layout and others.
interface Counter {
  count: number;
  step: number;
  label?: string;
  next?: Counter;
  bump?: (by: number) => number;
}

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

function byPattern({ count, step = -1, label = "unlabeled" }: Counter): string {
  return count + "/" + step + "/" + label;
}
function byNestedPattern(counter: Counter): string {
  const { next: { count = -2, label } = { count: -3, step: 0, label: "no next" } } = counter;
  return count + "/" + label;
}
function byRest(counter: Counter): string {
  const { count, ...rest } = counter;
  return count + "/" + JSON.stringify(rest);
}
function byChain(counter: Counter): unknown {
  return counter.next?.next?.count;
}
function byCallChain(counter: Counter): unknown {
  return counter.bump?.(2);
}
function increment(counter: Counter): number {
  return counter.count++;
}
function decrementFirst(counter: Counter): number {
  return --counter.count;
}
function addStep(counter: Counter): number {
  return (counter.count += counter.step);
}
function power(counter: Counter): number {
  return (counter.count **= 2);
}
function shift(counter: Counter): number {
  return (counter.count >>>= 1);
}
function labelIfMissing(counter: Counter): string {
  return (counter.label ??= "given");
}
function labelIfEmpty(counter: Counter): string {
  return (counter.label ||= "filled");
}
function labelIfPresent(counter: Counter): string | undefined {
  return (counter.label &&= counter.label + "+");
}
function kinds(counter: Counter): string {
  return typeof counter.count + "," + typeof counter.label + "," + typeof counter.next + "," + typeof counter.bump;
}
function has(counter: Counter): string {
  return ("count" in counter) + "," + ("label" in counter) + "," + ("toString" in counter);
}
function drop(counter: Counter): boolean {
  return delete counter.label;
}
function copy(counter: Counter): Counter {
  return { ...counter, step: 100 };
}
function enumerate(counter: Counter): string {
  let names = "";
  for (const name in counter) names += name + ";";
  return names;
}

function look(mark: string, make: () => unknown): void {
  const forms: [string, (counter: Counter) => unknown][] = [
    ["pattern", byPattern],
    ["nested", byNestedPattern],
    ["rest", byRest],
    ["chain", byChain],
    ["call chain", byCallChain],
    ["++", increment],
    ["--", decrementFirst],
    ["+=", addStep],
    ["**=", power],
    [">>>=", shift],
    ["??=", labelIfMissing],
    ["||=", labelIfEmpty],
    ["&&=", labelIfPresent],
    ["typeof", kinds],
    ["in", has],
    ["delete", drop],
    ["copy", copy],
    ["enumerate", enumerate],
  ];
  const kept = make() as Counter;
  console.log(mark);
  for (const [name, form] of forms) {
    const fresh = make() as Counter;
    console.log("  " + name + ":", attempt(() => form(fresh)), attempt(() => fresh), "|", attempt(() => form(kept)));
  }
  console.log("  kept:", attempt(() => kept));
}

class Reordered {
  label = "";
  step = 2.5;
  count = 10;
}
class WithAccessors {
  #count = 5;
  step = 1;
  get count(): number {
    return this.#count;
  }
  set count(value: number) {
    this.#count = value * 10;
  }
  get label(): string | undefined {
    return undefined;
  }
}

look("expected", (): Counter => ({ count: 1, step: 2 }));
look("expected, all fields", (): Counter => ({ count: 1, step: 2, label: "l", next: { count: 3, step: 4, next: { count: 5, step: 6 } }, bump: by => by * 2 }));
look("reordered", () => new Reordered());
look("parsed", () => JSON.parse('{"label":null,"next":{"label":"inner"},"count":"7","step":"8"}'));
look("accessors", () => new WithAccessors());
look("frozen", () => Object.freeze({ count: 1, step: 2, label: "frozen" }));
look("array", () => [1, 2]);
look("text", () => "text");
look("number", () => 5);
look("null", () => null);
look("expected", (): Counter => ({ count: 1, step: 2 }));

export {};
