// RUN: lower
// CHECK-LABEL: function {{*}}name="exits"
// CHECK: [[helper]] = Builtin builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: [[method]] = Call [[helper]], -, [[resource]]
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: = Call [[onReturn]], [[resource]]
// CHECK: Return [[returned]]
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: = Call [[onFallThrough]], [[resource]]
// CHECK: Return [[nothing]]
// CHECK: role=DisposalCleanup subject=[[resource]]
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: = Call [[onThrow]], [[resource]]
// CHECK: Throw

// RUN(COPIES): lower
// COPIES-COUNT-3: testedType=undefined
// COPIES-NOT: testedType=undefined

// RUN(PATHS): lower
// PATHS-NOT: Switch

declare function use(value: unknown): void;
declare function resource(): Disposable;
declare const flag: boolean;

export function exits() {
  using a = resource();
  if (flag) return 1;
  use(2);
}
