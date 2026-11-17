// What stands at the entry of the other kinds of functions: constructors, rest and default parameters, `arguments`, getters and setters, async functions and generators.
function show(label: string, run: () => unknown) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", (error as Error).constructor.name, (error as Error).message);
  }
}
const any = (value: unknown): any => value;
class Size {
  width: number;
  name: string;
  constructor(width: number, name: string = "unnamed") {
    this.width = width * 2;
    this.name = name + "!" + name.length;
  }
  get half() {
    return this.width / 2;
  }
  set half(value: number) {
    this.width = value * 2 + 0;
  }
}
class Wide extends Size {
  extra: number;
  constructor(width: number, extra: number) {
    super(width + extra, "wide");
    this.extra = extra - 1;
  }
}
function Legacy(this: any, count: number, label: string) {
  this.count = count + 1;
  this.label = label + label.length;
}
function rest(first: number, ...others: number[]) {
  let total = first * 2;
  for (const other of others) total += other;
  return total + "/" + others.length;
}
function defaults(a: number = 1, b: string = "b" + a, c: number = a * 2) {
  return a * 3 + "|" + b + b.length + "|" + c * 2;
}
function counts(a: number, b: number) {
  return arguments.length + "|" + a * 2 + "|" + (b === undefined ? "none" : b * 2) + "|" + Array.prototype.join.call(arguments, "+");
}
async function later(n: number, s: string) {
  const first = n * 2;
  await null;
  return first + s.length + "|" + typeof n;
}
function* steps(from: number, step: number) {
  let at = from * 1;
  for (let i = 0; i < 3; i++) {
    yield at;
    at += step;
  }
}
show("new right", () => JSON.stringify(new Size(2, "s")));
show("new default", () => JSON.stringify(new Size(2)));
show("new wrong", () => JSON.stringify(new Size(any("2"), any(5))));
show("new null", () => JSON.stringify(new Size(any(null), any(null))));
show("new missing", () => JSON.stringify(new (Size as any)()));
show("new right again", () => JSON.stringify(new Size(3, "t")));
show("called", () => (Size as any)(1, "x"));
show("derived right", () => JSON.stringify(new Wide(1, 2)));
show("derived wrong", () => JSON.stringify(new Wide(any("1"), any("2"))));
show("reflect construct", () => JSON.stringify(Reflect.construct(Size, [4, "r"], Wide)) + (Reflect.construct(Size, [4, "r"], Wide) instanceof Wide));
show("legacy new", () => JSON.stringify(new (Legacy as any)(1, "l")));
show("legacy new wrong", () => JSON.stringify(new (Legacy as any)("1", 5)));
show("legacy call", () => { const target: any = {}; Legacy.call(target, 2, "m"); return JSON.stringify(target); });
show("legacy call on a number", () => Legacy.call(5, 2, "m"));
show("legacy call on undefined", () => Legacy.call(undefined, 2, "m"));
show("getter and setter", () => { const size = new Size(5); size.half = 9; const a = size.half; size.half = any("9"); return a + "|" + size.half + "|" + size.width; });
show("rest", () => [rest(1), rest(1, 2, 3), rest(any("1"), 2), rest(1, any("2"), 3), (rest as any)(), rest(1, ...[4, 5, 6])].join(" "));
show("defaults", () => [defaults(), defaults(2), defaults(2, "x"), defaults(2, "x", 3), defaults(undefined, undefined, 4), defaults(any(null)), defaults(any("2"), any(5), any("3"))].join(" "));
show("defaults null text", () => defaults(1, any(null)));
show("counts", () => [(counts as any)(), (counts as any)(1), counts(1, 2), (counts as any)(1, 2, 3), counts(any("a"), any("b"))].join(" "));
show("generator", () => [[...steps(1, 2)].join(), [...steps(any("1"), any("2"))].join(), [...steps(any(null), any(undefined))].join(), [...steps(2, 3)].join()].join(" "));
const results = await Promise.allSettled([later(1, "ab"), later(any("1"), "ab"), later(1, any(null)), later(1, any(5)), later(2, "cd")]);
for (const result of results) console.log(result.status, result.status === "fulfilled" ? result.value : (result.reason as Error).message);
