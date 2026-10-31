// RUN: lower
// CHECK-LABEL: function {{*}}name="ReturnsInTry"
// CHECK: handler=
// CHECK: integer=1
// CHECK-NEXT: Jump -> next [[result]]()
// CHECK-NEXT: [[result]]():
// CHECK: TypeTest {{*}}testedType=undefined
// CHECK-NEXT: Branch {{*}}notTaken [[invalid]](| 0)
// CHECK: [[invalid]]([[rejected]]) frequency=Unlikely:
// CHECK-NEXT: runtimeError=DerivedConstructorResult
// CHECK-LABEL: function {{*}}name="ReturnsUnderFinally"
// CHECK-NOT: DerivedConstructorResult
// CHECK: key="cleanup"
// CHECK: runtimeError=DerivedConstructorResult
// CHECK-LABEL: function {{*}}name="ThrowsInTry"
// CHECK: handler=[[catch]](
// CHECK-NEXT: integer=1
// CHECK-NEXT: Throw
// CHECK: [[catch]]({{*}}) role=CatchHandler

// RUN(UNCOVERED): lower
// UNCOVERED-NOT: frequency=Unlikely handler=

declare function use(value: unknown): void;
declare function cleanup(): void;

class Base {}

export class ReturnsInTry extends Base {
  constructor() {
    super();
    try {
      return 1 as any;
    } catch (e) {
      use(e);
    }
  }
}

export class ReturnsUnderFinally extends Base {
  constructor() {
    super();
    try {
      return 1 as any;
    } finally {
      cleanup();
    }
  }
}

export class ThrowsInTry extends Base {
  constructor() {
    super();
    try {
      throw 1;
    } catch (e) {
      use(e);
    }
  }
}
