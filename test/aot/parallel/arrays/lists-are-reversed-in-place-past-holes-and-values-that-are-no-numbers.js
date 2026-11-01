function reverse(list, high) {
  for (let low = 0; low < high; low++, high--) {
    const held = list[low];
    list[low] = list[high];
    list[high] = held;
  }
  return list;
}
function swapByPattern(list, high) {
  for (let low = 0; low < high; low++, high--) [list[low], list[high]] = [list[high], list[low]];
  return list;
}
function show(list) {
  let text = "";
  for (let k = 0; k < list.length; k++) text += (k in list ? (Object.is(list[k], -0) ? "-0" : String(list[k])) : "-") + " ";
  return text + list.length;
}
const makers = [
  () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
  () => [1, 2, 3, 4, 5, 6],
  () => [0.5, NaN, 2.5, -0, Infinity, NaN],
  () => [NaN, NaN, NaN],
  () => [0.5, , 2.5, 3.5, , 5.5],
  () => [0.5, 1.5, "two", 3.5, undefined, null],
  () => [0.5],
  () => [],
];
let lines = "";
for (let turn = 0; turn < 4000; turn++) {
  lines = "";
  for (const make of makers) {
    for (const high of [0, 1, 2, 5, 7]) lines += show(reverse(make(), high)) + " | " + show(swapByPattern(make(), high)) + "\n";
  }
}
console.log(lines);
