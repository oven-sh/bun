// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[array]] = NewArray {{*}}contents=number
// CHECK-NEXT: Convert [[array]] declared={type=undefined|null|Array<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-LABEL: function {{*}}name="g"
// CHECK: [[strings]] = NewArray {{*}}contents=anything
// CHECK-NEXT: Return [[strings]]

// A constant that a literal of numbers initializes is expected to hold what the checker infers. Nothing is declared: an int32 is still proven by the elements.

export function f(n: number) {
  const row = [n];
  row.push(n + 1);
  return row;
}

export function g(s: string) {
  const row = [s, "t"];
  return row;
}
