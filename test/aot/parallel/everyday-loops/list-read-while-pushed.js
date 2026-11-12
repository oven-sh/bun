// The list is read at its end and at its start by the loops that push
function grow(start, factor) {
  const list = [start];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) {
      list.push(list[list.length - 1] * factor + list[k]);
    }
    list.push(list[i] - list[list.length - 2]);
  }
  return list.join();
}
console.log(grow(1, 2));
console.log(grow(0.5, -1));
console.log(grow(2147483647, 2), grow("3", 1));
