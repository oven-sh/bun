// A cast does nothing at run time: `as`, `<T>value`, `value!`, `satisfies` and `as const` let every value through, once and in a loop, and the code behind them does what plain Bun does with it.
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (value instanceof Map) return "Map(" + describe([...value]) + ")";
  if (value instanceof Set) return "Set(" + describe([...value]) + ")";
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).map(key => key + ": " + describe(record[key])).join(", ") + "}";
  }
  return Object.is(value, -0) ? "-0" : String(value);
}
// An error of the language (a member of null, a call of what is no function) is thrown by plain Bun too: its class is printed, not its text.
function say(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = describe(run());
  } catch (error) {
    line = "THREW " + (error as Error).constructor.name;
  }
  console.log(label + ": " + line);
}
// What nobody can know at build time.
const outside: any = JSON.parse(`{"text": "t", "number": 5, "nothing": null, "list": [1, "two", null], "record": {"x": "s"}, "yes": true}`);

interface Named {
  name: string;
  age: number;
}
class Animal {
  legs: number = 4;
  speak(): string {
    return "legs " + this.legs;
  }
}
enum Color {
  Red,
  Green,
}
type Tagged = { kind: "circle"; radius: number } | { kind: "square"; side: number };

say("a text as a number", () => {
  const value = outside.text as number;
  return [typeof value, value + 1, value * 2, value > 0];
});
say("a number as a text", () => {
  const value = outside.number as string;
  return [typeof value, value + "!", value.length];
});
say("a number as a text, its method called", () => (outside.number as string).toUpperCase());
say("null as an object", () => {
  const value = outside.nothing as Named;
  return [value === null, typeof value];
});
say("null as an object, its member read", () => (outside.nothing as Named).name);
say("the old form of a cast", () => {
  const value = <number>outside.text;
  return [typeof value, value + 1];
});
say("through unknown", () => {
  const value = 7 as unknown as string;
  return [typeof value, value + "!", value.length];
});
say("through unknown, a constant text as a number", () => {
  const value = "seven" as unknown as number;
  return [typeof value, value + 1, value - 1, -value];
});
say("non-null on null", () => {
  const maybe: Named | null = outside.nothing;
  const value = maybe!;
  return [value === null, typeof value];
});
say("non-null on undefined", () => {
  const maybe: Named | undefined = outside.missing;
  const value = maybe!;
  return [value === undefined, typeof value];
});
say("non-null on null, its member read", () => {
  const maybe: Named | null = outside.nothing;
  return maybe!.name;
});
say("non-null on an element that is not there", () => {
  const list: number[] = [1];
  const value = list[5]!;
  return [typeof value, value + 1];
});
say("a record of another shape as an interface", () => {
  const value = outside.record as Named;
  return [typeof value.name, typeof value.age, value.name + value.age];
});
say("a literal as an instance of a class", () => {
  const value = { legs: "many" } as unknown as Animal;
  return [typeof value.legs, value instanceof Animal, typeof value.speak];
});
say("a literal as an instance of a class, its method called", () => ({ legs: 2 } as unknown as Animal).speak());
say("a number outside an enum", () => {
  const value = 7 as Color;
  return [value, Color[value], value === Color.Red];
});
say("a text as an enum", () => {
  const value = outside.text as Color;
  return [typeof value, Color[value], value === Color.Green];
});
say("a text outside a union of literals", () => {
  const value = outside.text as "on" | "off";
  return [value, value === "on", value === "off"];
});
say("a switch over a union of literals that no case takes", () => {
  const value = outside.text as "on" | "off";
  switch (value) {
    case "on":
      return 1;
    case "off":
      return 2;
  }
  return "neither";
});
say("a tag that lies", () => {
  const value = { kind: "circle", side: 3 } as unknown as Tagged;
  return value.kind === "circle" ? [typeof value.radius, value.radius * 2] : value.side;
});
say("a tag that no arm has", () => {
  const value = { kind: "triangle" } as unknown as Tagged;
  if (value.kind === "circle") return value.radius;
  if (value.kind === "square") return value.side;
  return ["never", typeof value, (value as any).kind];
});
say("a function as another function type", () => {
  const value = ((text: string) => text + "!") as unknown as (count: number) => number;
  const answer = value(1);
  return [typeof answer, answer + 1];
});
say("what is no function as a function type", () => {
  const value = outside.number as () => number;
  return typeof value;
});
say("what is no function as a function type, called", () => (outside.number as () => number)());
say("a list as a tuple of another length", () => {
  const value = outside.list as [number, number];
  const [first, second] = value;
  return [value.length, typeof first, typeof second, first + second];
});
say("a text as a list", () => {
  const value = outside.text as unknown as number[];
  return [value.length, value[0], typeof value];
});
say("satisfies and as const", () => {
  const value = { x: 1, y: "two" } satisfies Record<string, unknown>;
  const fixed = [1, "two"] as const;
  (fixed as unknown as unknown[]).push(3);
  (value as any).x = "one";
  return [typeof value.x, fixed.length, fixed[0] + fixed[1]];
});
say("a type parameter that is told a lie", () => {
  function first<T>(list: T[]): T {
    return list[0]!;
  }
  const value = first<number>(outside.list.slice(1));
  return [typeof value, value + 1];
});
say("a type predicate that lies", () => {
  function isNumber(value: unknown): value is number {
    return true;
  }
  const value: unknown = outside.text;
  return isNumber(value) ? [typeof value, value + 1, value * 2] : "no";
});
say("an assertion function that lets everything through", () => {
  function assertNamed(value: unknown): asserts value is Named {}
  const value: unknown = outside.number;
  assertNamed(value);
  return [typeof value, typeof value.name, value.age];
});

say("in a loop: the 397th value is a text as a number", () => {
  let total = 0;
  for (let round = 0; round < 400; round++) {
    const value = (round === 396 ? outside.text : round) as number;
    total += value;
  }
  return total;
});
say("in a loop: the 397th value is null behind a non-null mark", () => {
  const all: (Named | null)[] = [];
  for (let round = 0; round < 400; round++) all.push(round === 396 ? null : { name: "n" + round, age: round });
  let nulls = 0;
  for (const each of all) {
    const value = each!;
    if (value === null) nulls++;
  }
  return nulls;
});
say("in a loop: the 397th value is null behind a non-null mark, its member read", () => {
  const all: (Named | null)[] = [];
  for (let round = 0; round < 400; round++) all.push(round === 396 ? null : { name: "n" + round, age: round });
  let ages = 0;
  for (const each of all) ages += each!.age;
  return ages;
});
say("in a loop: the 397th object is a literal as an instance", () => {
  let legs: unknown = 0;
  for (let round = 0; round < 400; round++) {
    const value = (round === 396 ? { legs: "many" } : new Animal()) as Animal;
    legs = value.legs;
    if (round === 396) break;
  }
  return legs;
});
