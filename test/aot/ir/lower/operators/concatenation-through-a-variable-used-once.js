// `const text = "a" + a; return text + b;` is printed `return "a" + a + b;`, which JavaScriptCore evaluates as one concatenation: it converts each operand right behind the operand's evaluation and records no position for that.
// RUN: lower
// CHECK-LABEL: function {{*}}name="numbers"
// CHECK: = Add {{*}} @564
// CHECK: = Add {{*}} @564
// CHECK-LABEL: function {{*}}name="texts"
// CHECK: = Add {{*}} @490
// CHECK: = Add {{*}} @509

export function texts(a, b) {
  const text = "a" + a;
  return text + b;
}

export function numbers(a, b, c) {
  const sum = a + b;
  return sum + c;
}
