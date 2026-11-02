// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = FinishClass
// CHECK: [[absent]] = Undefined
// CHECK: [[test]] = TypeTest [[absent]] testedType=undefined
// CHECK: Branch [[test]] -> taken
// CHECK: [[global]] = PropGet {{*}}key="Object" [isFreeName]
// CHECK: [[object]] = Convert [[global]] declared={type=builtin(Object) flags=[IsExpected]}
// CHECK: Jump -> next [[join]]([[object]])
// CHECK: [[join]]([[type]]):
// CHECK: [[define]] = Builtin builtin=CompilerHelpersDefineMetadata
// CHECK: = Call [[define]], -, {{*}}, [[type]] @
// CHECK: builtin=CompilerHelpersDecorateProperty

// RUN(IMPORT): lower
// IMPORT-NOT: CheckInitialized {{*}}name="Shape"

import { Shape } from "./imports/shape";

declare const d: any;

export class C {
  @d p!: Shape;
}
