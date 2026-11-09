// The built-in gets the text when the program runs: none of it is compiled with the program, be it a constant or not.

// RUN: lower
// CHECK-LABEL: function {{*}}name="call"
// CHECK-NOT: StrictEq
// CHECK-NOT: NewClosure
// CHECK: [[callCallee]] = Convert {{*}}declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: [[callParameter]] = String string="a"
// CHECK-NEXT: [[callText]] = String string="return a"
// CHECK-NEXT: = Call [[callCallee]], -, [[callParameter]], [[callText]] calleeName="Function"
// CHECK-NOT: StrictEq
// CHECK-NOT: NewClosure
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
// CHECK-NEXT: = Call [[indirectCallee]], -, [[script]]
// CHECK-NOT: StrictEq
// CHECK-NOT: NewClosure
// CHECK-LABEL: function {{*}}name="textWithFunction"
// CHECK-NOT: NewClosure
// CHECK: [[textWithFunction]] = String string="return function onlyInText() {};"
// CHECK-NEXT: = Construct {{*}}, -, [[textWithFunction]] calleeName="Function"
// CHECK-NOT: NewClosure

// RUN(PROGRAM): link
// PROGRAM-NOT: function {{*}}name="onlyInText"

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
