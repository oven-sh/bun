// A list made with a length is allocated where the call stands, with storage that a store by index finds: no store asks the run time.
// COUNT: operation:operationAOTPutByVal <= 1000
// COUNT: operations <= 20000
function keep(first, second) {
  const names = new Array(arguments.length - 2);
  const values = new Array(arguments.length - 2);
  for (let i = 0; i < names.length; i++) {
    names[i] = arguments[i + 2];
    values[i] = second[names[i]];
  }
  return names.length + values.length + (first ? 1 : 0);
}
function sized(n) {
  const list = new Array(n);
  list[0] = n;
  return list.length;
}
let sum = 0;
const holder = { a: 1, b: 2, c: 3 };
for (let turn = 0; turn < 100000; turn++) {
  sum += keep(turn, holder, "a", "b", "c");
  sum += sized(turn & 15);
  sum += Array(turn & 7).length;
}
console.log(sum);
