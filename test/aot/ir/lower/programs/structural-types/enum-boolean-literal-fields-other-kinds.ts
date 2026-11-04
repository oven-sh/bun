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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=i32}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="color"
// CHECK-NEXT: v2 = Convert v1 declared={type=i32}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="look"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="colorOf"
// CHECK-NEXT: v3 = PropGet v0 key="color"
// CHECK-NEXT: v4 = TypeOf v3
// CHECK-NEXT: v5 = PropGet v0 key="color"
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = StrictEq v5, v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = PropGet v0 key="color"
// CHECK-NEXT: v10 = ElemGet v8, v9
// CHECK-NEXT: v11 = PropGet v0 key="on"
// CHECK-NEXT: v12 = PropGet v0 key="on"
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v14):
// CHECK-NEXT: v15 = String string="on"
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: v17 = String string="off"
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: v19 = PropGet v0 key="on"
// CHECK-NEXT: v20 = Boolean boolean=true
// CHECK-NEXT: v21 = StrictEq v19, v20
// CHECK-NEXT: v22 = PropGet v0 key="digit"
// CHECK-NEXT: v23 = PropGet v0 key="digit"
// CHECK-NEXT: v24 = Integer
// CHECK-NEXT: v25 = StrictEq v23, v24
// CHECK-NEXT: v26 = PropGet v0 key="way"
// CHECK-NEXT: v27 = PropGet v0 key="way"
// CHECK-NEXT: v28 = String string="UP"
// CHECK-NEXT: v29 = StrictEq v27, v28
// CHECK-NEXT: v30 = PropGet v0 key="size"
// CHECK-NEXT: v31 = PropGet v0 key="size"
// CHECK-NEXT: v32 = String string="s"
// CHECK-NEXT: v33 = StrictEq v31, v32
// CHECK-NEXT: v34 = PropGet v0 key="after"
// CHECK-NEXT: v35 = Builtin builtin=Object
// CHECK-NEXT: v36 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v37 = Call v36, v35, v0 calleeName="Object.keys"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v39 = PropGet v38 key="join"
// CHECK-NEXT: v40 = Call v39, v38 calleeKey="join" calleeName="join"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v42 = Builtin builtin=JSON
// CHECK-NEXT: v43 = PropGet v42 key="stringify"
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v45 = Call v44, v42, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v47 = NewArray v2, v4, v7, v10, v11, v18, v21, v22, v25, v26, v29, v30, v33, v34, v41, v46 contents=anything
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v48
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Pixel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_4]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
