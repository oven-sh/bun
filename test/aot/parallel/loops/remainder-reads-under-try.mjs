const table0 = [];
let sum = 0;
const state = { count: 3, last: -2147483648, more: "m" };
function show(value) {
}
function compute0(a) {
  let v0 = a | 0;
  let v1 = -1;
  let v2 = a | 0;
  try {
    for (let i4 = 0; i4 < 3; i4++) {
    }
    let i5 = 3;
    do {
      v2 = table0[+sum % +sum];
      v2 += v0 - a;
      if (table0[a & 3] > i5) {
      }
    } while (--i5 >= 0);
  } catch (error) {
  }
  return [v0, v1, v2];
}
console.log(show(compute0(5)));
console.log(show(sum), show(state.count), show(state.last), show(table0));
