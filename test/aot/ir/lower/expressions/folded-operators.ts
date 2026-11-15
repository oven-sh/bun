// RUN: lower
// CHECK-LABEL: function {{*}}name="concatenated"
// CHECK: = String string="ab"
// CHECK-LABEL: function {{*}}name="notFolded"
// CHECK: = LShift
// CHECK-LABEL: function {{*}}name="shifted"
// CHECK: = Integer integer=4
// CHECK-LABEL: function {{*}}name="template"
// CHECK: = String string="a1"
// CHECK-LABEL: function {{*}}name="typeName"
// CHECK: = String string="string"
// CHECK-LABEL: function {{*}}name="voided"
// CHECK: = Undefined

// RUN(SHIFTS): lower
// SHIFTS-COUNT-1: = LShift
// SHIFTS-NOT: = LShift

// RUN(NOWHERE): lower
// NOWHERE-NOT: = Add
// NOWHERE-NOT: = Strcat
// NOWHERE-NOT: = ToString
// NOWHERE-NOT: = TypeOf

export function concatenated() {
  return "a" + "b";
}

export function notFolded(x: any) {
  return x << 2;
}

export function shifted() {
  return 1 << 2;
}

export function template() {
  return `a${1}`;
}

export function typeName() {
  return typeof "a";
}

export function voided() {
  return void 0;
}
