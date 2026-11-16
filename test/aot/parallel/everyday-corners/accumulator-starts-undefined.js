// Accumulator starts undefined: compiled answers as plain.
function total(list) {
  let t;
  for (const v of list) t = t === undefined ? v : t + v;
  return t;
}
console.log(total([1, 2, 3]), total([]), total(["a", 1]), total([1.5]), total([undefined, 1]));
