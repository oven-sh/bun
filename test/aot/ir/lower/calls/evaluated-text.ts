// The function of a constant text is compiled with the program, beside the call of the built-in. Any other text is the run's.

// RUN: lower
// CHECK-LABEL: function {{*}}name="call"
// CHECK: [[callCallee]] = Convert {{*}}declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: [[callParameter]] = String string="a"
// CHECK-NEXT: [[callText]] = String string="return a"
// CHECK: = Call [[callCallee]], -, [[callParameter]], [[callText]] calleeName="Function"
// CHECK-LABEL: function {{*}}name="construct"
// CHECK-NOT: StrictEq
// CHECK-NOT: NewClosure
// CHECK: [[constructCallee]] = Convert {{*}}declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: [[constructText]] = String string="return 1"
// CHECK-NEXT: = Construct [[constructCallee]], -, [[constructText]] calleeName="Function"
// CHECK-NOT: StrictEq
// CHECK-NOT: NewClosure
// CHECK-LABEL: function {{*}}name="dynamicText"
// CHECK-NOT: StrictEq
// CHECK-COUNT-1: = Call
// CHECK-NOT: StrictEq
// CHECK-NOT: = Call
// CHECK-LABEL: function {{*}}name="indirect"
// CHECK-NOT: StrictEq
// CHECK-NOT: NewClosure
// CHECK: [[indirectCallee]] = Convert {{*}}declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: [[script]] = String string="1 + 1"
// CHECK: = Call [[indirectCallee]], -, [[script]]
// CHECK-NOT: StrictEq
// CHECK-NOT: NewClosure
// CHECK-LABEL: function {{*}}name="textWithFunction"
// CHECK: [[textWithFunction]] = String string="return function onlyInText() {};"
// CHECK: = Construct {{*}}, -, [[textWithFunction]] calleeName="Function"

// RUN(PROGRAM): link
// PROGRAM: function {{*}}name="onlyInText"

export function call() {
  return Function("a", "return a");
}

export function construct() {
  return new Function("return 1");
}

export function dynamicText(text: string) {
  return Function(text);
}

export function indirect() {
  return (0, eval)("1 + 1");
}

export function textWithFunction() {
  return new Function("return function onlyInText() {};");
}
