// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[firstTest]] = ToBoolean
// CHECK: Branch [[firstTest]] -> taken
// CHECK: Jump -> next [[firstJoin]](
// CHECK: [[firstHead]] = NewObject
// CHECK: [[firstCreated]] = FinishObject [[firstHead]]
// CHECK: Jump -> next [[firstJoin]]([[firstCreated]]
// CHECK: [[firstJoin]]([[first]]
// CHECK: PropSet [[first]], {{*}}key="A"
// CHECK: [[secondTest]] = ToBoolean
// CHECK: Branch [[secondTest]] -> taken
// CHECK: Jump -> next [[secondJoin]](
// CHECK: [[secondHead]] = NewObject
// CHECK: [[secondCreated]] = FinishObject [[secondHead]]
// CHECK: Jump -> next [[secondJoin]]([[secondCreated]]
// CHECK: [[secondJoin]]([[second]]
// CHECK: PropSet [[second]], {{*}}key="B"

// RUN(TESTS): lower
// TESTS-COUNT-2: = ToBoolean
// TESTS-NOT: = ToBoolean

export enum E {
  A,
}

export enum E {
  B = 1,
}
