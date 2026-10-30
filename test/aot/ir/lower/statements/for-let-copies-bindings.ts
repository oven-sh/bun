// RUN: lower
// CHECK-LABEL: function {{*}}name="letHead"
// CHECK-NOT: = NewObject
// CHECK: LoopHint
// CHECK-NOT: = NewObject
// CHECK: Branch {{*}} -> taken [[body]](| 0),
// CHECK: [[body]]([[i]]):
// CHECK-NOT: = NewObject
// CHECK: = NewClosure [[i]] function=
// CHECK-NOT: = NewObject
// CHECK: = Increment [[i]]
// CHECK-NOT: = NewObject
// CHECK-LABEL: function {{*}}name="letHeadStoredByClosure"
// CHECK-LABEL: function {{*}}name="varHead"
// CHECK: = NewObject
// CHECK-NOT: = NewObject
// CHECK: LoopHint
// CHECK-NOT: = NewObject

// RUN(COPIES): lower
// COPIES-LABEL: function {{*}}name="letHeadStoredByClosure"
// COPIES: = NewObject {{*}}layout=[[environment]]
// COPIES: = NewObject {{*}}layout=[[environment]]
// COPIES-NOT: = NewObject
// COPIES: LoopHint
// COPIES-NOT: = NewObject
// COPIES: = NewClosure
// COPIES: = NewObject {{*}}layout=[[environment]]
// COPIES-NOT: = NewObject
// COPIES: Increment
// COPIES-NOT: = NewObject
// COPIES-LABEL: function {{*}}name="varHead"

export function letHeadStoredByClosure(fs: Function[]) {
  for (let i = 0; i < 3; i++) fs.push(() => i++);
}

// Only the update stores `i`, so each closure takes a copy of its value and the loop has no environment.
export function letHead(fs: Function[]) {
  for (let i = 0; i < 3; i++) fs.push(() => i);
}

export function varHead(fs: Function[]) {
  for (var i = 0; i < 3; i++) fs.push(() => i);
}
