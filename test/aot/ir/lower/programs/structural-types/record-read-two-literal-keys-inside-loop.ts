// RUN: lower
// OPTIONS: builtin-modules

// A record is read under one of two literal keys inside a loop over an array.
type ColorKey = "color-0" | "color-1";
const byColor: Record<ColorKey, number> = { "color-0": 1, "color-1": 2 };
function keyOf(color: number): ColorKey {
  return `color-${color}` as ColorKey;
}
function read(color: number): number {
  return byColor[keyOf(color)];
}

const whole: number[] = [2, 1, 0];
for (const n of whole) console.log("whole", n, read(n));

const mixed: number[] = [2, 0.5, -0, NaN, 1e21, 1];
for (const n of mixed) console.log("mixed", n, read(n), read(n) + 1);

const pushed: number[] = [];
pushed.push(1, 0.5, 0);
for (const n of pushed) console.log("pushed", n, read(n), typeof read(n));

const counted: number[] = [0, 3, 1];
for (let i = 0; i < counted.length; i++) console.log("counted", counted[i], read(counted[i]), read(counted[i]) === undefined);

// GENERATED: keyOf read
// CHECK-LABEL: function {{*}}name="keyOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=undefined|null|"color-0"|"color-1" flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = String string="color-"
// CHECK-NEXT: v2 = ToString v0
// CHECK-NEXT: v3 = Strcat v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|"color-0"|"color-1" flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="byColor"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="keyOf"
// CHECK-NEXT: v5 = ElemGet v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
