// Shift count from a list: compiled answers as plain.
function sh(x, list) {
  let r = [];
  for (const k of list) r.push(x << k, x >> k, x >>> k);
  return r.join();
}
console.log(sh(-1, [0, 1, 31, 32, 33, -1]), sh(1, [31, 32]));
