// RUN: lower
// CHECK-LABEL: function {{*}}name="lastOf"
// CHECK-NOT: PropDefine
// CHECK-NOT: declared={type=boolean
// CHECK: = NewObject {{*}}fields=[1, 0]
// CHECK-LABEL: function {{*}}name="plainOf"
// CHECK-NOT: PropDefine
// CHECK-NOT: declared={type=boolean
// CHECK: = NewObject {{*}}fields=[1, 0]

// `first` reads the variable that the loop stores the literal in. To type it the checker goes around the loop, comes to the literal while it is checking it, and checks it a second time. What the second check makes is a type of that literal like the first: it says which names the object has, and nobody has declared what they hold. So both literals are built alike.
export function lastOf(list) {
  let last;
  for (const item of list) {
    last = { worth: item.worth, first: last === undefined };
  }
  return { last };
}

export function plainOf(list) {
  let kept;
  for (const item of list) {
    kept = { worth: item.worth, closed: item.closed === true };
  }
  return { kept };
}
