// RUN: lower
// OPTIONS: builtin-modules

// A getter answers differently after narrowing.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.radius * 3;
    case "square":
      return s.side * s.side;
  }
}

function double(o: { readonly v: number | string }): number | string {
  return typeof o.v === "number" ? o.v * 2 : "text: " + o.v;
}

function fixed(o: { readonly v: number | string }): string {
  if (typeof o.v === "number") return o.v.toFixed(1);
  return o.v.toUpperCase();
}

function lengthOf(o: { name: string | null }): number {
  return o.name === null ? -1 : o.name.length;
}

function callIt(o: { f?: () => number }): number {
  return o.f ? o.f() : -1;
}

function alternating(): { readonly v: number | string } {
  let reads = 0;
  return {
    get v() {
      log.push("get-v");
      return reads++ % 2 === 0 ? 1 : "text";
    },
  };
}

class Flicker {
  #reads = 0;
  get v(): number | string {
    return this.#reads++ % 2 === 0 ? 1 : "text";
  }
  get name(): string | null {
    return this.#reads++ % 2 === 0 ? "name" : null;
  }
  set name(value: string | null) {}
  get f(): (() => number) | undefined {
    return this.#reads++ % 2 === 0 ? () => 5 : undefined;
  }
}

function flickeringShape(): Shape {
  let reads = 0;
  return {
    get kind(): "square" | "circle" {
      log.push("get-kind");
      return reads++ % 2 === 0 ? "square" : "circle";
    },
    radius: 2,
    side: 5,
  };
}

attempt("honest double", () => [double({ v: 2 }), double({ v: "a" })]);
attempt("honest fixed", () => [fixed({ v: 2 }), fixed({ v: "a" })]);
attempt("honest lengthOf", () => [lengthOf({ name: "ab" }), lengthOf({ name: null })]);
attempt("honest callIt", () => [callIt({ f: () => 1 }), callIt({})]);
attempt("honest area", () => [area({ kind: "circle", radius: 1 }), area({ kind: "square", side: 2 })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += Number(double({ v: i })) + fixed({ v: i }).length + lengthOf({ name: "ab" }) + callIt({ f: () => i }) + area({ kind: "square", side: i });
console.log("2000 honest rounds", warm);

attempt("a literal's getter: double", () => double(alternating()));
attempt("a literal's getter: fixed", () => fixed(alternating()));
attempt("a class's getter: double", () => double(new Flicker()));
attempt("a class's getter: fixed", () => fixed(new Flicker()));
attempt("a class's getter: lengthOf", () => lengthOf(new Flicker()));
attempt("a class's getter: callIt", () => callIt(new Flicker()));
attempt("the tag is a getter: area", () => area(flickeringShape()));
attempt("the tag is a getter: twice", () => {
  const s = flickeringShape();
  return [area(s), area(s), area(s)];
});
attempt("the tag is a getter: if", () => {
  const s = flickeringShape();
  if (s.kind === "square") return s.kind + ":" + s.side;
  return s.kind + ":" + s.radius;
});
attempt("in a field", () => {
  class Holder {
    o: { readonly v: number | string } = alternating();
    read(): number | string {
      return typeof this.o.v === "number" ? this.o.v + 1 : this.o.v + "!";
    }
  }
  return new Holder().read();
});
attempt("in an element", () => {
  const list: { readonly v: number | string }[] = [{ v: 1 }, alternating(), { v: "z" }];
  return list.map(double);
});
attempt("honest again", () => [double({ v: 2 }), fixed({ v: 2 }), lengthOf({ name: "ab" }), callIt({ f: () => 1 }), area({ kind: "circle", radius: 1 })]);

// GENERATED: area alternating Flicker name
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: SwitchString v1 strings=["circle", "square"] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByField v0, v2 key="kind"
// CHECK-NEXT: v4 = PropGet v3 key="radius"
// CHECK-NEXT: v5 = Integer integer=3
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = NarrowByField v0, v8 key="kind"
// CHECK-NEXT: v10 = PropGet v9 key="side"
// CHECK-NEXT: v11 = PropGet v9 key="side"
// CHECK-NEXT: v12 = Mul v10, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="alternating"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_4]]
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: PutEnvironmentField v0, v2 layout=[[L_4]]
// CHECK-NEXT: v4 = NewObject layout=[[L_3]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: DefineGetter v4, v5 key="v"
// CHECK-NEXT: v7 = FinishObject v4
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Flicker"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_7]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_6]]} results=[{type=undefined|null|string flags=[OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_6]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_6]] field=1
// CHECK-NEXT: v3 = ToNumeric v2
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: PrivateSet v0, v5, v4 layout=[[L_6]] field=1
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Mod v3, v7
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = StrictEq v8, v9
// CHECK-NEXT: Branch v10 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v11 = String string="name"
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: Jump -> next b3(v12)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
