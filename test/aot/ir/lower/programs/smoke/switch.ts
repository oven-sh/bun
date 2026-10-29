// RUN: lower
// OPTIONS: builtin-modules

// switch over numbers, strings and with cases that fall through.
function classify(value: number | string | null): string {
  switch (value) {
    case 0:
    case 1:
      return "small";
    case 2:
      value = 3;
    case 3: {
      const inner = "three";
      return inner + value;
    }
    case "text":
      return "string";
    case null:
      return "null";
    default:
      break;
  }
  switch (typeof value) {
    case "number":
      return value > 100 ? "big" : "medium";
    default:
      return "other";
  }
}
console.log([0, 1, 2, 3, "text", null, 50, 500, "x"].map(classify));
function dynamic(x: number, y: number): string {
  switch (true) {
    case x > y:
      return "greater";
    case x === y:
      return "equal";
  }
  return "less";
}
console.log(dynamic(1, 2), dynamic(2, 2), dynamic(3, 2));

// GENERATED: dynamic
// CHECK-LABEL: function {{*}}name="dynamic"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=number site=[[w_2]]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = Greater v0, v1
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = String string="greater"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = StrictEq v0, v1
// CHECK-NEXT: v8 = StrictEq v2, v7
// CHECK-NEXT: Branch v8 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = String string="equal"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = String string="less"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
