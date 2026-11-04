// RUN: lower
// Every list of keys names the indexes first, so a member under an index is defined behind the names, which the allocation then holds side by side.
// The values are computed in the order in which they are written.
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: Call {{*}}calleeName="first"
// CHECK: Call {{*}}calleeName="second"
// CHECK: Call {{*}}calleeName="third"
// CHECK: [[head_of_computed]] = NewObject {{*}}fields=[0, 1] @
// CHECK: ElemDefine [[head_of_computed]],
// CHECK-NEXT: = FinishObject [[head_of_computed]]

// What a condition decides is defined where the condition has decided.
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK: Branch
// CHECK: ElemDefine
// CHECK-NEXT: Jump
// CHECK: PropDefine {{*}}key="y"

// CHECK-LABEL: function {{*}}name="create"
// CHECK: b0([[a_of_create]]{{*}}, [[b_of_create]]{{*}}, [[c_of_create]]{{*}}):
// CHECK: [[head_of_create]] = NewObject -, [[c_of_create]] layout=[[layout_of_create]] fields=[0] @
// CHECK: [[zero_of_create]] = Integer @
// CHECK: ElemDefine [[head_of_create]], [[zero_of_create]], [[a_of_create]]
// CHECK: [[one_of_create]] = Integer integer=1
// CHECK: ElemDefine [[head_of_create]], [[one_of_create]], [[b_of_create]]
// CHECK-NEXT: = FinishObject [[head_of_create]]

// Of two members under one key the later one holds. What may be a member under the index stands behind its definition.
// CHECK-LABEL: function {{*}}name="getter"
// CHECK: ElemDefine [[head_of_getter]],
// CHECK: DefineGetter [[head_of_getter]],
// CHECK-LABEL: function {{*}}name="key"
// CHECK: b0([[a_of_key]]{{*}}, [[b_of_key]]{{*}}, {{*}}):
// CHECK: ElemDefine [[head_of_key]], {{*}}, [[a_of_key]]
// CHECK-NEXT: ElemDefine [[head_of_key]], {{*}}, [[b_of_key]]
// CHECK-LABEL: function {{*}}name="spread"
// CHECK: ElemDefine [[head_of_spread]],
// CHECK-NEXT: CopyDataProperties [[head_of_spread]],
// CHECK-NEXT: PropDefine [[head_of_spread]], {{*}} key="x"

// One odd key among the names of a table would make a definition by name of every name behind it.
// CHECK-LABEL: function {{*}}name="table"
// CHECK: [[head_of_table]] = NewObject layout=
// CHECK: PropDefine [[head_of_table]], {{*}} key="a"
// CHECK-NOT: ElemDefine
// CHECK: PropDefine [[head_of_table]], {{*}} key="b"
// CHECK-NOT: ElemDefine
// CHECK: PropDefine [[head_of_table]], {{*}} key="c"
// CHECK: [[seven_of_table]] = Integer integer=7
// CHECK: ElemDefine [[head_of_table]], [[seven_of_table]],
// CHECK: [[nine_of_table]] = Integer integer=9
// CHECK: ElemDefine [[head_of_table]], [[nine_of_table]],
// CHECK-NEXT: = FinishObject [[head_of_table]]

export function create(a: unknown, b: unknown, c: unknown) {
  return { 0: a, "1": b, x: c };
}
export function table(): Record<string, string> {
  return { a: "x", 7: "seven", b: "y", 9: "nine", c: "z" };
}
declare function first(): number;
declare function second(): number;
declare function third(): number;
export function computed() {
  return { x: first(), 7: second(), y: third() };
}
export function spread(a: unknown, other: object) {
  return { 7: a, ...other, x: a };
}
export function key(a: unknown, b: unknown, name: string) {
  return { 7: a, [name]: b };
}
export function getter(a: unknown) {
  return {
    7: a,
    get 7() {
      return 1;
    },
  };
}
export function conditional(a: unknown, takes: boolean) {
  return { x: a, ...(takes && { 7: a }), y: a };
}
