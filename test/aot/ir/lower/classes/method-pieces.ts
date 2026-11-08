// RUN: lower
// CHECK: [[head]] = NewClass
// CHECK: DefineMethod [[head]], [[method]] layout=[[layout]] key="m"
// CHECK: DefineMethod [[head]], [[getter]] layout=[[layout]] methodKind=Getter index=1 key="g"
// CHECK: DefineMethod [[head]], [[setter]] layout=[[layout]] methodKind=Setter index=2 key="s"
// CHECK: DefineMethod [[head]], [[static]] layout=[[layout]] side=Static index=3 key="t"
// CHECK: [[key]] = ToPropertyKey
// CHECK: DefineMethod [[head]], [[computed]], [[key]] layout=[[layout]] index=4 @
// CHECK: = FinishClass [[head]]

// RUN(PIECES): lower
// PIECES-COUNT-5: DefineMethod
// PIECES-NOT: DefineMethod

declare const k: string;

export class C {
  m() {}
  get g() {
    return 1;
  }
  set s(value: number) {}
  static t() {}
  [k]() {}
}
