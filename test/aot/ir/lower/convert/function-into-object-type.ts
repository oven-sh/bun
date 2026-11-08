// RUN: link
// CHECK-NOT: name="two"{{*}}functionTypes=

// A function has no layout, so it joins the family of no object type, and nothing is declared for its sake: no position has its type. That holds for an argument, which is
// converted where the callee is entered, and for a variable, which is converted where it is stored.
interface Sized {
  length: number;
}

function measure(sized: Sized) {
  return sized.length;
}

function two(first: number, second: number) {
  return first + second;
}

export const measured = measure(two);
export const held: Sized = two;
