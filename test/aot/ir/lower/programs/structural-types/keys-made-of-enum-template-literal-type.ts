// RUN: lower
// OPTIONS: builtin-modules

// Keys made of an enum in a template literal type.
enum Color {
  Red,
  Green,
}
enum Way {
  Up = "UP",
  Down = "DOWN",
}
type ColorKey = `color-${Color}`;
type WayKey = `${Way}-${Color}`;

const byColor: Record<ColorKey, number> = { "color-0": 1, "color-1": 2 };
const byWay: Partial<Record<WayKey, string>> = { "UP-0": "up red" };

function keyOf(color: Color): ColorKey {
  return `color-${color}`;
}
function read(color: Color): number {
  return byColor[keyOf(color)];
}
function wayKey(way: Way, color: Color): WayKey {
  return `${way}-${color}`;
}

console.log(keyOf(Color.Green), read(Color.Green), wayKey(Way.Up, Color.Red), byWay[wayKey(Way.Up, Color.Red)], byWay[wayKey(Way.Down, Color.Red)]);
const numbers: number[] = [2, 0.5, -0, NaN, 1e21];
for (const n of numbers) {
  const color: Color = n;
  console.log(keyOf(color), read(color), read(color) === undefined, typeof read(color), read(color) + 1, wayKey(Way.Down, color));
}

// GENERATED: keyOf read
// CHECK-LABEL: function {{*}}name="keyOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_1]]}] results=[{type=undefined|null|"color-0"|"color-1" site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="color-"
// CHECK-NEXT: v2 = ToString v0
// CHECK-NEXT: v3 = Strcat v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|"color-0"|"color-1" site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_3]]}] results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="byColor"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="keyOf"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"color-0"|"color-1" site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = ElemGet v2, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
