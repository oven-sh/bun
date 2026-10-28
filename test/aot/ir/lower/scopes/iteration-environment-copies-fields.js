// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[header]]([[environment]]: env [[layout]]):
// CHECK-NEXT: LoopHint
// CHECK: = NewClosure [[environment]] function=
// CHECK: [[i]] = GetEnvironmentField [[environment]] layout=[[layout]]
// CHECK-NEXT: [[copy]] = NewObject -, [[i]] layout=[[layout]] fields=[0]
// CHECK: Jump -> next [[header]]([[copy]])

export function f(fs) {
  for (let i = 0; i < 3; i++) fs.push(() => i++);
}
