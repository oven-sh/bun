// The list stands in front of two loops. The inner loop, which is entered once a turn of the outer one, reads its elements, and a turn of the outer loop changes its storage or its length.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function work(list, at, way, rows) {
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    if (row === at) {
      if (way === 0) list.length = 1;
      else if (way === 1) list[1] = 0.5;
      else if (way === 2) list[1] = "text";
      else if (way === 3) delete list[1];
      else if (way === 4) list[100000] = 1;
      else for (let k = 0; k < 40; k++) list.push(k);
    }
    for (let cell = 0; cell < 3; cell++) sum = mix(sum, list[cell] === undefined ? -1000 : list[cell].length === 4 ? 4 : list[cell]);
  }
  return mix(sum, list.length);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work([i, 1, 2], i % 9, i % 6, 8));
console.log(total);
