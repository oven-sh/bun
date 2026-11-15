// The same with numbers alone: integers, then fractions
function table(from, to, step) {
  const list = [];
  for (let i = from; i < to; i += step) {
    list.push(i);
    for (let k = i; k > i - 3; k -= step) list.push(k * i);
  }
  return list;
}
console.log(table(0, 5, 1).join());
console.log(table(1, 3, 0.5).join());
console.log(table(2147483645, 2147483648, 1).length, table(-1, 1, 0.5).join());
