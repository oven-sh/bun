// RUN: lower
// OPTIONS: builtin-modules

// Enum boolean and literal fields get other kinds of values by reflection.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Color {
  Red,
  Green,
  Blue,
}
enum Way {
  Up = "UP",
  Down = "DOWN",
}

class Pixel {
  color: Color = Color.Red;
  on: boolean = false;
  digit: 0 | 1 | 2 = 0;
  way: Way = Way.Up;
  size: "s" | "m" = "s";
  after: number = 7;
}

function colorOf(pixel: Pixel): Color {
  return pixel.color;
}
function look(pixel: Pixel): unknown[] {
  return [
    colorOf(pixel),
    typeof pixel.color,
    pixel.color === Color.Red,
    Color[pixel.color],
    pixel.on,
    pixel.on ? "on" : "off",
    pixel.on === true,
    pixel.digit,
    pixel.digit === 0,
    pixel.way,
    pixel.way === Way.Up,
    pixel.size,
    pixel.size === "s",
    pixel.after,
    Object.keys(pixel).join(),
    JSON.stringify(pixel),
  ];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const pixel = new Pixel();
  pixel.color = i % 3;
  pixel.on = i % 2 === 0;
  pixel.digit = i % 2 ? 1 : 2;
  warm += look(pixel).length + pixel.color + pixel.digit;
}
console.log("2000 honest rounds", warm);

const values: unknown[] = [300, -1, 1.5, -0, NaN, 2 ** 31, "text", "", null, undefined, true, 0, 5n, [1], { a: 1 }];
const names = ["color", "on", "digit", "way", "size"];
for (const name of names) {
  for (const value of values) {
    attempt(name + " = " + show(value) + " by Reflect.set", () => {
      const pixel = new Pixel();
      Reflect.set(pixel, name, value);
      return typeof value === "bigint" ? look(pixel).slice(0, -1) : look(pixel);
    });
  }
}
attempt("all at once by Object.assign", () => {
  const pixel = new Pixel();
  Object.assign(pixel, { color: "red", on: 1, digit: 2.5, way: 0, size: null });
  return look(pixel);
});
attempt("all at once by defineProperty", () => {
  const pixel = new Pixel();
  for (const name of names) Object.defineProperty(pixel, name, { value: name.length * 100.5, writable: true, enumerable: true, configurable: true });
  return look(pixel);
});
attempt("all deleted", () => {
  const pixel = new Pixel();
  for (const name of names) Reflect.deleteProperty(pixel, name);
  return look(pixel);
});
attempt("typed stores afterwards", () => {
  const pixel = new Pixel();
  Object.assign(pixel, { color: "red", on: 1, digit: 2.5, way: 0, size: null });
  pixel.color = Color.Blue;
  pixel.on = true;
  pixel.digit = 2;
  pixel.way = Way.Down;
  pixel.size = "m";
  return look(pixel);
});
attempt("honest again", () => look(new Pixel()));

// GENERATED: colorOf look Pixel
// CHECK-LABEL: function {{*}}name="colorOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=i32 site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="color"
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 site=[[w_3]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="look"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="colorOf"
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 site=[[w_7]]}
// CHECK-NEXT: v4 = PropGet v0 key="color"
// CHECK-NEXT: v5 = TypeOf v4
// CHECK-NEXT: v6 = PropGet v0 key="color"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = StrictEq v6, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v11 = PropGet v0 key="color"
// CHECK-NEXT: v12 = ElemGet v10, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = PropGet v0 key="on"
// CHECK-NEXT: v15 = PropGet v0 key="on"
// CHECK-NEXT: v16 = ToBoolean v15
// CHECK-NEXT: Branch v16 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v17):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = String string="on"
// CHECK-NEXT: Jump -> next b6(v18)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = String string="off"
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = PropGet v0 key="on"
// CHECK-NEXT: v23 = Boolean boolean=true
// CHECK-NEXT: v24 = StrictEq v22, v23
// CHECK-NEXT: v25 = PropGet v0 key="digit"
// CHECK-NEXT: v26 = PropGet v0 key="digit"
// CHECK-NEXT: v27 = Integer
// CHECK-NEXT: v28 = StrictEq v26, v27
// CHECK-NEXT: v29 = PropGet v0 key="way"
// CHECK-NEXT: v30 = PropGet v0 key="way"
// CHECK-NEXT: v31 = String string="UP"
// CHECK-NEXT: v32 = StrictEq v30, v31
// CHECK-NEXT: v33 = PropGet v0 key="size"
// CHECK-NEXT: v34 = PropGet v0 key="size"
// CHECK-NEXT: v35 = String string="s"
// CHECK-NEXT: v36 = StrictEq v34, v35
// CHECK-NEXT: v37 = PropGet v0 key="after"
// CHECK-NEXT: v38 = Builtin builtin=Object
// CHECK-NEXT: v39 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v40 = Call v39, v38, v0 calleeName="Object.keys"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|Array<undefined|null|string> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v42 = PropGet v41 key="join"
// CHECK-NEXT: v43 = Call v42, v41 calleeKey="join" calleeName="join"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v45 = Builtin builtin=JSON
// CHECK-NEXT: v46 = PropGet v45 key="stringify"
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v48 = Call v47, v45, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v50 = NewArray v3, v5, v8, v13, v14, v21, v24, v25, v28, v29, v32, v33, v36, v37, v44, v49 contents=anything
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|Array site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v51
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Pixel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_12]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
