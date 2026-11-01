// Flags: --aot-verify-each-pass
// As its neighbour, with a counter below -(2 ** 31): no read is inside the view.
function sum(list, unused, start) {
  let turns = 0, total = 0, still = 0, value = 0;
  for (let i = start; i < -2147483648; ) {
    if (++turns > 9) break;
    value = list[i]; total += value;
    total += i > 2147483647 ? 1 : 2;
    const before = i++;
    for (let j = i; j < i + 2; j++) { value = list[j & 3]; total = (total + (value | 0)) | 0; }
    for (let k = before - 1; k < before; k++) { value = list[k - -2147483650]; total += value; }
    value = list[i]; total += value;
    value = list[before & 3]; total += value;
  }
  return [total, still, value];
}
console.log([[0, 1].map(() => ((list) => String(sum(list, { n: -2147483650, b: -2147483648, m: [0.5, 2] }, -2147483650)))(new Float32Array(5))).join(";"), ((list) => String(sum(list, { n: -2147483650, b: -2147483648, m: [1, 2] }, -2147483650)) + "/" + String(list))(new Float32Array(4))].join(" "));
