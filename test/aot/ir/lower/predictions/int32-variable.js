// RUN: lower
// CHECK-LABEL: function {{*}}name="bits"
// CHECK: [[ten]] = Integer integer=10
// CHECK-NEXT: = Convert [[ten]] declared={type=i32 flags=[IsExpected]}
// CHECK: [[mixed]] = BitOr
// CHECK-NEXT: = Convert [[mixed]] declared={type=i32 flags=[IsExpected]}
// CHECK: [[lowered]] = Decrement
// CHECK-NEXT: = Convert [[lowered]] declared={type=i32 flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="everyOther"
// CHECK: [[two]] = Integer integer=2
// CHECK-NEXT: [[stepped]] = Add {{*}}, [[two]]
// CHECK-NEXT: = Convert [[stepped]] declared={type=i32 flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="halved"
// CHECK-NOT: i32
// CHECK-LABEL: function {{*}}name="index"
// CHECK: [[zero]] = Integer
// CHECK-NEXT: = Convert [[zero]] declared={type=i32 flags=[IsExpected]}
// CHECK: [[raised]] = Increment
// CHECK-NEXT: = Convert [[raised]] declared={type=i32 flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="neighbor"
// CHECK: [[first]] = Integer
// CHECK-NEXT: = Convert [[first]] declared={type=i32 flags=[IsExpected]}

// A variable of an unchecked file that starts as an integer, is given only integers and is an operand of a bit operator or a key, as it stands or in a sum, is expected to hold an int32.

export function bits(n) {
  let sum = 0;
  for (let i = 10; i > n; i--) sum = sum ^ i << 1 | 0;
  return sum;
}

export function everyOther(list) {
  let text = "";
  for (let i = 0; i < list.length; i += 2) text += list[i];
  return text;
}

export function halved(list) {
  let text = "";
  for (let i = 8; i >= 1; i = i / 2) text += list[i];
  return text;
}

export function index(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) text += list[i];
  return text;
}

export function neighbor(list) {
  let text = "";
  for (let i = 0; i < 4; i++) text += list[i + 1];
  return text;
}
