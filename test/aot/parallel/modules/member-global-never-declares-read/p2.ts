function print(text: string): void {
  console.log(text);
}
function describe(value: unknown, depth: number = 0): string {
  if (typeof value === "function") return "function";
  if (Object.is(value, -0)) return "number -0";
  const text = String(value);
  return typeof value + " " + (text.includes("=>") || text.includes("function") || text.includes("class ") ? "with the text of a function" : text);
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
const table: number[] = [10, 20, 30];
const lookup: Record<string, number> = { ab: 1, cd: 2, text: 3 };
enum Mode1 {
  Off,
  On,
  Auto,
}
class Inner1 {
  depth = 1;
  twice(): number {
    return this.depth * 2;
  }
}
const taken1: (string | Promise<string>)[] = [];
class Stranger1 {
  other = "stranger";
  total(): string {
    return "total of a stranger";
  }
}
const conversions1: string[] = [];
class Root1 {
  label = "wxyz";
}
function withFirst1(Base: new () => Root1) {
  return class extends Base {
    leaf: Inner1 | null = new Inner1();
  };
}
function withSecond1(Base: new () => InstanceType<ReturnType<typeof withFirst1>>) {
  return class extends Base {
    x = 1.5;
  };
}
function withThird1(Base: new () => InstanceType<ReturnType<typeof withSecond1>>) {
  return class extends Base {
    limit: number | undefined = 4.5;
    words = ["x", "y", "z"];
    mode: Mode1 = Mode1.On;
    total(): number {
      return this.x;
    }
    text(): string {
      return this.label + ":" + (this.x);
    }
  };
}
const Planet1 = withThird1(withSecond1(withFirst1(Root1)));
type Planet1 = InstanceType<typeof Planet1>;
function helper1(given: Planet1): number {
  return (given.x) * 2;
}
function scaled1(given: Planet1, by: number): number {
  return (given.x) * by;
}
class Runner1 {
  out: string;
  constructor(v: Planet1) {
    let out = "";
    const list: Planet1[] = [v];
    try { out += "\n1:label.read " + describe(list[0].label); } catch (error) { out += "\n1:label.read " + errorName(error); }
    try { out += "\n2:leaf.read " + describe(list[0].leaf); } catch (error) { out += "\n2:leaf.read " + errorName(error); }
    try { out += "\n3:x.read " + describe(list[0].x); } catch (error) { out += "\n3:x.read " + errorName(error); }
    try { out += "\n4:limit.read " + describe(list[0].limit); } catch (error) { out += "\n4:limit.read " + errorName(error); }
    try { out += "\n5:words.read " + describe(list[0].words); } catch (error) { out += "\n5:words.read " + errorName(error); }
    try { out += "\n6:mode.read " + describe(list[0].mode); } catch (error) { out += "\n6:mode.read " + errorName(error); }
    try { out += "\n7:limit.chained-to-string " + describe(list[0].limit?.toString()); } catch (error) { out += "\n7:limit.chained-to-string " + errorName(error); }
    try { out += "\n8:mode.greater " + describe(list[0].mode > Mode1.Off); } catch (error) { out += "\n8:mode.greater " + errorName(error); }
    try { out += "\n9:kinds-of-values " + describe(Object.values(list[0]).map(each => typeof each).join()); } catch (error) { out += "\n9:kinds-of-values " + errorName(error); }
    try { out += "\n10:map-of-entries " + describe(new Map(Object.entries(list[0])).size); } catch (error) { out += "\n10:map-of-entries " + errorName(error); }
    try { const it = list[0].limit; out += "\n11:limit.or-minus-one " + describe(it ?? -1); } catch (error) { out += "\n11:limit.or-minus-one " + errorName(error); }
    try { out += "\n12:own-names " + describe(Object.getOwnPropertyNames(list[0]).join()); } catch (error) { out += "\n12:own-names " + errorName(error); }
    try { const cells = new Float64Array(2); cells[0] = list[0].x; out += "\n13:x.in-a-typed-array " + describe(cells[0]); } catch (error) { out += "\n13:x.in-a-typed-array " + errorName(error); }
    try { out += "\n14:limit.is-undefined " + describe(list[0].limit === undefined); } catch (error) { out += "\n14:limit.is-undefined " + errorName(error); }
    try { out += "\n15:leaf.typeof-is-function " + describe(typeof list[0].leaf === "function"); } catch (error) { out += "\n15:leaf.typeof-is-function " + errorName(error); }
    try { out += "\n16:is-sealed " + describe(Object.isSealed(list[0])); } catch (error) { out += "\n16:is-sealed " + errorName(error); }
    try { out += "\n17:tag " + describe(Object.prototype.toString.call(list[0])); } catch (error) { out += "\n17:tag " + errorName(error); }
    try { out += "\n18:is-nullish " + describe(list[0] == null); } catch (error) { out += "\n18:is-nullish " + errorName(error); }
    try { out += "\n19:words.first-is-undefined " + describe(list[0].words[0] === undefined); } catch (error) { out += "\n19:words.first-is-undefined " + errorName(error); }
    try { out += "\n20:typeof-value-of " + describe(typeof list[0].valueOf()); } catch (error) { out += "\n20:typeof-value-of " + errorName(error); }
    try { out += "\n21:limit.or-fallback " + describe(list[0].limit ?? "fallback"); } catch (error) { out += "\n21:limit.or-fallback " + errorName(error); }
    try { out += "\n22:limit.is-undefined " + describe(list[0].limit === undefined); } catch (error) { out += "\n22:limit.is-undefined " + errorName(error); }
    this.out = out;
  }
}
function probe1(v: Planet1): string {
  return new Runner1(v).out;
}
async function case1(): Promise<void> {
  print("c1 # store-through-a-union-alias, three-mixins, mid-loop, changed in place, held in element, used in constructor, errors inline");
  print("c1.helper " + helper1(new Planet1()));
  const victim: Planet1 = new Planet1();
  try {
    let last = "";
    for (let turn = 0; turn < 2000; turn++) {
      if (turn === 1990) {
        try {
          {
            const wide: { limit: number | undefined | object } = victim;
            wide.limit = ({});
          }
        } catch (error) {
          print("c1.change " + errorName(error));
        }
      }
      last = probe1(victim);
    }
    report("c1.after", last);
  } catch (error) {
    print("c1.loop " + errorName(error));
  }
  try {
    report("c1.fresh", probe1(new Planet1()));
  } catch (error) {
    print("c1.fresh " + errorName(error));
  }
  print("c1.conversions " + conversions1.length + ": " + conversions1.slice(0, 40).join(" "));
}
const taken2: (string | Promise<string>)[] = [];
class Stranger2 {
  other = "stranger";
  total(): string {
    return "total of a stranger";
  }
}
const conversions2: string[] = [];
type Sensor2 = {
  extra?: number;
  label: string;
  active: boolean;
  x: number;
  note?: string;
  total(): number;
  text(): string;
};
function make2(): Sensor2 {
  return { label: "ab", active: true, x: 7, total(): number { return this.x; }, text(): string { return this.label + ":" + (this.x); } };
}
function helper2(given: Sensor2): number {
  return (given.x) * 2;
}
function scaled2(given: Sensor2, by: number): number {
  return (given.x) * by;
}
function alter2(target: Sensor2): void {
  {
    const wide: { x: number | Date } = target;
    wide.x = new Date(0);
  }
}
function probe2(v: Sensor2): string {
  let out = "";
  Shelf2.held = v;
  for (let round = 0; round < 2; round++) {
    out += "\n1:extra.read " + describe(Shelf2.held.extra);
    out += "\n2:label.read " + describe(Shelf2.held.label);
    out += "\n3:active.read " + describe(Shelf2.held.active);
    out += "\n4:x.read " + describe(Shelf2.held.x);
    out += "\n5:note.read " + describe(Shelf2.held.note);
    out += "\n6:label.lower " + describe(Shelf2.held.label.toLowerCase());
    { const { label, ...rest } = Shelf2.held; out += "\n7:rest " + describe([label, rest]); }
    out += "\n8:active.to-number " + describe(Number(Shelf2.held.active));
    out += "\n9:is-sealed " + describe(Object.isSealed(Shelf2.held));
    out += "\n10:active.typeof-is-bigint " + describe(typeof Shelf2.held.active === "bigint");
    out += "\n11:text " + describe(Shelf2.held.text());
    out += "\n12:x.times " + describe(Shelf2.held.x * 2);
    out += "\n13:x.repeats " + describe("ab".repeat(Shelf2.held.x));
    out += "\n14:to-string " + describe(String(Shelf2.held));
    out += "\n15:spread-with-more " + describe(({ before: 0, ...Shelf2.held, after: 1 }));
    out += "\n16:scaled-by-apply " + describe(scaled2.apply(undefined, [Shelf2.held, 1.5]));
    out += "\n17:helper " + describe(helper2(Shelf2.held));
    out += "\n18:x.floor " + describe(Math.floor(Shelf2.held.x));
    out += "\n19:has-own-property " + describe(Shelf2.held.hasOwnProperty("active"));
  }
  return out;
}
class Shelf2 {
  static held: Sensor2 = make2();
}
async function case2(): Promise<void> {
  print("c2 # store-through-a-union-alias, type-literal, first, changed in a callee, held in static-field, used in loop, errors bare");
  print("c2.helper " + helper2(make2()));
  const victim: Sensor2 = make2();
  try {
    alter2(victim);
  } catch (error) {
    print("c2.change " + errorName(error));
  }
  try {
    report("c2.after", probe2(victim));
  } catch (error) {
    print("c2.after " + errorName(error));
  }
  try {
    report("c2.fresh", probe2(make2()));
  } catch (error) {
    print("c2.fresh " + errorName(error));
  }
  print("c2.conversions " + conversions2.length + ": " + conversions2.slice(0, 40).join(" "));
}
try {
  await case1();
} catch (error) {
  print("c1.escaped " + errorName(error));
}
try {
  await case2();
} catch (error) {
  print("c2.escaped " + errorName(error));
}
export {};
