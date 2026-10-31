function rotate(list, r) {
  const first = list[0];
  for (let k = 0; k < r; k++) list[k] = list[k + 1];
  list[r] = first;
  return first;
}
function show(list) {
  let text = "";
  for (let k = 0; k < list.length; k++) text += (k in list ? String(list[k]) : "-") + " ";
  return text + list.length;
}
const makers = [
  () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
  () => [1, 2, 3, 4, 5, 6],
  () => [0.5, NaN, 2.5, -0, Infinity, 5.5],
  () => [0.5, , 2.5, 3.5, , 5.5],
  () => [0.5, 1.5, "two", 3.5, undefined, null],
  () => [0.5, 1.5],
  () => [],
];
let lines = "";
for (let turn = 0; turn < 4000; turn++) {
  lines = "";
  for (const make of makers) {
    for (const r of [0, 1, 3, 5, 6, 8]) {
      const list = make();
      const first = rotate(list, r);
      lines += String(first) + " | " + show(list) + "\n";
    }
  }
}
console.log(lines);
