// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = Call {{*}}calleeName="base"
// CHECK: = ResolveHeritage
// CHECK: = NewClassToken
// CHECK: [[constructor]] = NewClosure
// CHECK: [[head]] = NewClass [[constructor]],
// CHECK: = Call {{*}}calleeName="key1"
// CHECK: DefineMethod [[head]],
// CHECK: = PropGet {{*}}key="key2"
// CHECK: [[class]] = FinishClass [[head]]
// CHECK-NEXT: [[receiver]] = Convert [[class]] declared={type=function flags=[IsFromCompiler]}
// CHECK-NEXT: = CallDirect [[receiver]] function=[[initializer]]
// CHECK: function [[initializer]] {{*}}kind=Initializer{{*}}thisType={type=function flags=[IsFromCompiler]}

// RUN(HEAD): lower
// HEAD: [[head]] = NewClass [[constructor]],
// HEAD: = FinishClass [[head]]
// HEAD-NOT: [[head]]
// HEAD: Return

declare function base(): new () => object;
declare function key1(): string;
declare const key2: string;

export default class extends base() {
  [key1()]() {}
  static [key2] = 1;
  #p = 0;
}
