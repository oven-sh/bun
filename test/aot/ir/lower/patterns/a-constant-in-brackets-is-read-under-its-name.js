// A pattern reads a key in brackets that holds a constant under its name, as `object[KEY]` does. The load takes the key for that name; a read under a key that nobody knows would enter what the load
// has left out. A `const` is read first, for its dead zone. A key that is worked out when the program runs is made a property key once, and read as one.
// RUN: lower
// CHECK-LABEL: function {{*}}name="byConstant"
// CHECK: = PropGet {{*}} key="kk"
// CHECK-NOT: ElemGet
// CHECK-LABEL: function {{*}}name="byWhatRuns"
// CHECK: [[key]] = ToPropertyKey
// CHECK: = ElemGet {{*}}, [[key]]
const KEY = "kk";
function byConstant(holder) {
  const { [KEY]: held } = holder;
  return held;
}
function byWhatRuns(holder, name) {
  const { [name()]: held } = holder;
  return held;
}
console.log(byConstant, byWhatRuns);
