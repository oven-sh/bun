// RUN: lower
// OPTIONS: builtin-modules

// A method is replaced by one with other parameters.
class Mixer {
  mix(a: number, b: number, c: number): string {
    return "three: " + a + " " + b + " " + c;
  }
}

function mixOf(m: Mixer): string {
  return m.mix(1, 2, 3);
}

function spreadInto(m: Mixer, values: [number, number, number]): string {
  return m.mix(...values);
}

function round(label: string, m: Mixer): void {
  console.log(label + ": " + m.mix(1, 2, 3) + " | " + mixOf(m) + " | " + spreadInto(m, [4, 5, 6]) + " | length " + m.mix.length);
}

const m = new Mixer();
const other = new Mixer();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += mixOf(m).length + mixOf(other).length;
console.log("2000 honest: " + warm);
round("the method", m);

const replacements: [string, (a: number, b: number, c: number) => string][] = [
  ["none", () => "none"],
  ["one", a => "one: " + a],
  ["two", (a, b) => "two: " + a + " " + b],
  ["a fourth that is optional", (a: number, b: number, c: number, d?: number) => "four: " + a + " " + b + " " + c + " " + d],
  ["a fourth with a default", (a: number, b: number, c: number, d: number = 40) => "four: " + a + " " + b + " " + c + " " + d],
  ["a default in the middle", (a: number, b: number = 20, c?: number) => "defaults: " + a + " " + b + " " + c],
  ["rest", (...all: number[]) => "rest: " + all.length + " " + all.join()],
  ["one and rest", (a: number, ...more: number[]) => "one and rest: " + a + " " + more.length + " " + more.join()],
  [
    "the arguments object",
    function () {
      return "arguments: " + arguments.length + " " + Array.from(arguments).join();
    },
  ],
  ["a pattern with a default", (a: number, b: number, c: number, { d }: { d: number } = { d: 44 }) => "pattern: " + a + " " + b + " " + c + " " + d],
  ["wider parameters", (a: number | string, b: unknown, c: number | undefined) => "wider: " + typeof a + " " + typeof b + " " + typeof c],
];

for (const [label, replacement] of replacements) {
  m.mix = replacement;
  round("own, " + label, m);
}
round("the other", other);

Reflect.deleteProperty(m, "mix");
round("uncovered", m);

const original = Mixer.prototype.mix;
for (const [label, replacement] of replacements) {
  Mixer.prototype.mix = replacement;
  round("on the prototype, " + label, other);
}
Mixer.prototype.mix = original;
round("put back", other);

export {};

// GENERATED: spreadInto round Mixer mix
// CHECK-LABEL: function {{*}}name="spreadInto"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|Array<number>):
// CHECK-NEXT: v2 = PropGet v0 key="mix"
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v3, v1
// CHECK-NEXT: v5 = CallList v2, v0, v3 calleeKey="mix" calleeName="m.mix"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="round"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = PropGet v1 key="mix"
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = Integer integer=3
// CHECK-NEXT: v13 = Call v9, v1, v10, v11, v12 calleeKey="mix" calleeName="m.mix"
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = String string=" | "
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v18 = Call v17, -, v1 calleeName="mixOf"
// CHECK-NEXT: v19 = Add v16, v18
// CHECK-NEXT: v20 = String string=" | "
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v23 = Data data=[[d_4]]
// CHECK-NEXT: v24 = Call v22, -, v1, v23 calleeName="spreadInto"
// CHECK-NEXT: v25 = Add v21, v24
// CHECK-NEXT: v26 = String string=" | length "
// CHECK-NEXT: v27 = Add v25, v26
// CHECK-NEXT: v28 = PropGet v1 key="mix"
// CHECK-NEXT: v29 = PropGet v28 key="length"
// CHECK-NEXT: v30 = Add v27, v29
// CHECK-NEXT: v31 = Call v6, v4, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Mixer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mix"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=number}, {type=number}, {type=number}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number, v1: number, v2: number):
// CHECK-NEXT: v3 = String string="three: "
// CHECK-NEXT: v4 = Add v3, v0
// CHECK-NEXT: v5 = String string=" "
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Add v6, v1
// CHECK-NEXT: v8 = String string=" "
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Add v9, v2
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
