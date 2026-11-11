// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK: [[head]] = NewObject layout=[[layout]] @
// CHECK: [[getter]] = NewClosure
// CHECK: DefineGetter [[head]], [[getter]] key="a"
// CHECK: [[setter]] = NewClosure
// CHECK: DefineSetter [[head]], [[setter]] key="a"
// CHECK: [[key]] = ToPropertyKey
// CHECK: [[computed]] = NewClosure
// CHECK: SetFunctionName [[computed]], [[key]] methodKind=Getter
// CHECK: DefineGetter [[head]], [[computed]], [[key]] @
// CHECK: = FinishObject [[head]]

// RUN(ONCE): lower
// ONCE-LABEL: function {{*}}name="create"
// ONCE-COUNT-1: calleeName="k"
// ONCE-NOT: calleeName="k"
// ONCE: Return

declare function k(): string;

export function create() {
  return {
    get a() {
      return 1;
    },
    set a(value: number) {},
    get [k()]() {
      return 2;
    },
  };
}
