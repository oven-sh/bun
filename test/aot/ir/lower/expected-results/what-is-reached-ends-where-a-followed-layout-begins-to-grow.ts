// RUN: lower
// CHECK-LABEL: function {{*}}name="lateGrowth"
// CHECK: Return

// RUN(EARLY): lower
// EARLY-LABEL: function {{*}}name="earlyGrowth"
// EARLY: Return

// `Leaf` and `Nest<T>` have the same names, so they are one layout. What is reached from `Late` follows `zlast` first: the layout is followed while `Leaf` is its only written type. `later` then
// lays `Nest<number>` on it, so it is followed again, and that look meets `Nest<Nest<number>>` and its like: the layout grows without end and is followed no further. It stayed among the layouts
// that have got new types since they were followed, and the build went round for ever. In `Early` the names of the fields put `Wrap` first: that always had an end.
interface Leaf {
  nested: number;
  next: null;
}

interface Nest<T> {
  nested: T;
  next: Nest<Nest<T>> | null;
}

interface Wrap {
  inner: Nest<number>;
}

interface Late {
  later: Wrap;
  zlast: Leaf;
}

interface Early {
  first: Leaf;
  later: Wrap;
}

declare function make<T>(): T;

export function lateGrowth() {
  return make<Late>();
}

export function earlyGrowth() {
  return make<Early>();
}
