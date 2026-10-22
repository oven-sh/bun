// RUN: lower
// CHECK-LABEL: function {{*}}name="asynchronous"
// CHECK: [[no]] = Boolean @
// CHECK: [[helper]] = Builtin builtin=CompilerHelpersGetAsyncDisposeMethod
// CHECK-NEXT: [[method]] = Call [[helper]], -, [[resource]]
// CHECK: integer=1
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: handler=[[catch]]([[no]]):
// CHECK-NEXT: [[result]] = Call [[present]], [[resource]]
// CHECK-NEXT: [[yes]] = Boolean boolean=true
// CHECK: handler=[[catch]]([[yes]]):
// CHECK-NEXT: = Await [[result]]
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: = Await [[nothing]]
// CHECK: Return

declare function use(value: unknown): void;
declare function asyncResource(): AsyncDisposable;

export async function asynchronous() {
  await using a = asyncResource();
  use(1);
}
