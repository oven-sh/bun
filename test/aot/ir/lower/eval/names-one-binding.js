// A direct eval in strict code whose text is known at the build and is nothing but the name of a binding that the call sees reads that binding: nothing is evaluated, and no scope record is made.
// RUN: link
// CHECK: function [[f]] name="f" module=
// CHECK: [[c]] = Call
// CHECK: [[eval]] = Builtin builtin=Eval
// CHECK-NEXT: [[isEval]] = StrictEq [[callee]], [[eval]]
// CHECK-NEXT: Branch [[isEval]] -> taken [[direct]](), notTaken [[ordinary]](| 0)
// CHECK: [[direct]]():
// CHECK-NEXT: Jump -> next [[join]]([[c]])
// CHECK: [[ordinary]]([[other]]):
// CHECK: [[returned]] = Call [[other]],
// CHECK: Jump -> next [[join]]([[returned]])

// RUN(NONE): lower
// NONE-NOT: DirectEval

export function f() {
  const c = g();
  return eval("c");
}

export function folded() {
  const require = g();
  return eval("quire".replace(/^/, "re"));
}
