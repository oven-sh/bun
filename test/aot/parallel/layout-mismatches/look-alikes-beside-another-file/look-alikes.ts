function print(text: string): void {
  console.log(text);
}
function describe(value: unknown, depth: number = 0): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return value.includes("=>") || value.includes("function") || value.includes("class ") ? "string with the text of a function" : "string " + JSON.stringify(value);
  if (value === null) return "null";
  if (depth > 1) return Array.isArray(value) ? "array" : "object";
  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && index < 8; index++) parts.push(index in value ? describe(value[index], depth + 1) : "hole");
    return "array of " + value.length + " [" + parts.join(", ") + "]";
  }
  for (const key of Object.keys(value)) parts.push(key + ": " + describe(Reflect.get(value, key), depth + 1));
  return "object {" + parts.join(", ") + "}";
}
function errorName(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
}
function see(run: () => unknown): string {
  try {
    return describe(run());
  } catch (error) {
    return errorName(error);
  }
}
function report(stage: string, text: string): void {
  for (const line of text.split("\n")) if (line) print(stage + "." + line);
}
function nothing(): void {}
function spell(text: string): string {
  return text.split("").join("");
}
class Root1 {
  x = 2.25;
}
function pickBase1() {
  return Root1;
}
const bases1 = { first: Root1 };
class Sensor1 extends Object.assign(Root1, {}) {
  label = "wxyz";
  total(): number {
    return this.x;
  }
  text(): string {
    return this.label + ":" + (this.x);
  }
}
function helper1(given: Sensor1): number {
  return (given.x) * 2;
  return (given.x) * by;
}
class Twin1 {
  label: string = "wxyz";
  out: string;
  constructor(v: Sensor1) {
    out += "\n14:x.is-nullish " + see(() => v.x == null);
    this.out = out;
  }
}
function probe1(v: Sensor1): string {
  return new Runner1(v).out;
  print("c1.conversions " + conversions1.length + ": " + conversions1.slice(0, 40).join(" "));
}
class Inner2 {
  depth = 1;
  twice(): number {
    return this.depth * 2;
  }
}
const taken2: (string | Promise<string>)[] = [];
const conversions2: string[] = [];
class Root2 {
  x = 1.5;
}
function withFirst2(Base: new () => Root2) {
  return class extends Base {
    label = "cd";
  };
}
function withSecond2(Base: new () => InstanceType<ReturnType<typeof withFirst2>>) {
  return class extends Base {
    leaf: Inner2 | null = new Inner2();
  };
}
function withThird2(Base: new () => InstanceType<ReturnType<typeof withSecond2>>) {
  return class extends Base {
    total(): number {
      return this.x;
    }
    text(): string {
      return this.label + ":" + (this.x);
    }
  };
}
const Point2 = withThird2(withSecond2(withFirst2(Root2)));
type Point2 = InstanceType<typeof Point2>;
function helper2(given: Point2): number {
  return (given.x) * 2;
}
function scaled2(given: Point2, by: number): number {
  return (given.x) * by;
}
class Twin2 {
  leaf: Inner2 | null = new Inner2();
  label: string = "cd";
  get x(): number {
    return 1.5;
  }
  set x(value: number) {}
  total(): number {
    return -1;
  }
  text(): string {
    return "twin";
  }
}
class Keeper2 {
  constructor(public held: Point2) {}
}
function inner2({ held: v }: { held: Point2 }): string {
  let out = "";
  const keeper = new Keeper2(v);
  out += "\n1:x.read " + see(() => keeper.held.x);
  out += "\n2:label.read " + see(() => keeper.held.label);
  out += "\n3:leaf.read " + see(() => keeper.held.leaf);
  out += "\n6:leaf.typeof-is-symbol " + see(() => typeof keeper.held.leaf === "symbol");
  out += "\n7:or-fallback " + see(() => keeper.held ?? "fallback");
  return out;
}
function probe2(v: Point2): string {
  return inner2({ held: v });
}
async function case2(): Promise<void> {
  const honest: Point2 = new Point2();
  for (const each of await Promise.allSettled(taken2.splice(0))) report("c2.early", each.status === "fulfilled" ? each.value : "\nprobe " + errorName(each.reason));
  let warm = 0;
  for (let turn = 0; turn < 2000; turn++) warm += (probe2(honest)).length;
  print("c2.warm " + warm);
  try {
    const victim: Point2 = new Twin2();
    taken2.push(probe2(victim));
  } catch (error) {
    print("c2.arrival " + errorName(error));
    print("c2.honest-after " + errorName(error));
  }
  print("c2.conversions " + conversions2.length + ": " + conversions2.slice(0, 40).join(" "));
}
class Inner3 {
  depth = 1;
  twice(): number {
    return this.depth * 2;
  }
}
const taken3: (string | Promise<string>)[] = [];
const conversions3: string[] = [];
class Root3 {
  active = true;
}
function withFirst3(Base: new () => Root3) {
  return class extends Base {
    leaf: Inner3 | null = new Inner3();
    label = "cd";
    x = 40;
    y = 7;
    total(): number {
      return this.x + this.y;
    }
    text(): string {
      return this.label + ":" + (this.x + this.y);
    }
  };
}
const Recipe3 = withFirst3(Root3);
type Recipe3 = InstanceType<typeof Recipe3>;
function helper3(given: Recipe3): number {
  return (given.x + given.y) * 2;
}
function scaled3(given: Recipe3, by: number): number {
  return (given.x + given.y) * by;
}
class Twin3 {
  get y(): number {
    return 7;
  }
  set y(value: number) {}
  get x(): number {
    return 40;
  }
  set x(value: number) {}
  label: string = "cd";
  leaf: Inner3 | null = new Inner3();
  active: boolean = true;
  total(): number {
    return -1;
  }
  text(): string {
    return "twin";
  }
}
function* walk3(v: Recipe3): Generator<string, void, undefined> {
  let out = "";
  yield out; out = "";
}
function probe3(v: Recipe3): string {
  let out = "";
  for (const part of walk3(v)) out += part;
  return out;
}
async function case3(): Promise<void> {
  try {
    const victim: Recipe3 = new Twin3();
    taken3.push(probe3(victim));
  } catch (error) {
  }
}
try {
  await case2();
} catch (error) {
}
try {
} catch (error) {
}

export {};
