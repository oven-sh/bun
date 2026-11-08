const o = {}; process.on.call(o, "x", () => {}); const above = Object.getPrototypeOf(o._events ?? o);
above.removeListener = function (type, target) {
  target["push"](7);
  target[0] = target[-1] + 10;
};
function forget(target, times) {
  let mixed = 7;
  for (let turn = 0; turn < times; turn++) {
    mixed = (mixed * 31 + turn) | 0;
    mixed ^= mixed >>> 5;
    process.removeListener("tick", target);
    if ((mixed & 3) === 1) mixed = (mixed + 7) | 0;
    Bun.gc(true);
  }
  return mixed;
}
function grown(list, times) {
  const before = list.length;
  forget(list, times);
  return list.length - before;
}
function raised(list, times) {
  const before = list[0];
  forget(list, times);
  return list[0] - before;
}
function total(list, times) {
  let sum = 0;
  for (let index = 0; index < list.length && index < 12; index++) {
    forget(list, times);
    sum += list[index];
  }
  return sum;
}
const given = JSON.parse("[1,2,3,2]");
let lengths = 0, firsts = 0;
for (let place = 0; place < 4; place++) {
  const times = given[place] | 0;
  lengths += grown([times, 2, 3], times);
  firsts += raised([times, 2, 3], times);
}
console.log(lengths, firsts, total([1, 2, 3], given[0] | 0));
