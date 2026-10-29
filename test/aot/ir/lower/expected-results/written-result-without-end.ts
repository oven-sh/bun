// RUN: lower
// CHECK-LABEL: function {{*}}name="endless"
// CHECK-NOT: expectedResult=
// CHECK: Return

// RUN(FINITE): lower
// FINITE-LABEL: function {{*}}name="finite"
// FINITE: = Call {{*}}expectedResult=
// FINITE: Return

// RUN(NESTED): lower
// NESTED-LABEL: function {{*}}name="nested"
// NESTED: = Call {{*}}expectedResult=
// NESTED: Return

// STATISTIC: MaxExpectedResultLayoutsHits = 1

// The fields of `Grow<"a">` reach `Grow<"ax">`, whose fields reach `Grow<"axx">`. Each has a name of its own, so each is a layout: more layouts than
// one expected result lists, so the call is an ordinary call. The next call is not affected. The fields of `Nest<T>` reach `Nest<Nest<T>>`, which has
// the names of `Nest<T>` and so its layout: that has an end.
type Grow<K extends string> = {
  [P in K | "next"]: P extends "next" ? Grow<`${K}x`> | undefined : number;
};

interface List<T> {
  value: T;
  next: List<T> | undefined;
}

interface Nest<T> {
  nested: T;
  next: Nest<Nest<T>> | undefined;
}

declare function make<T>(): T;

export function endless() {
  return make<Grow<"a">>();
}

export function finite() {
  return make<List<number>>();
}

export function nested() {
  return make<Nest<number>>();
}
