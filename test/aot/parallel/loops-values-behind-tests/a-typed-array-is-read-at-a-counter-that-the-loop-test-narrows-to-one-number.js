// Flags: --aot-verify-each-pass
// The read at the end of a turn finds the counter inside the view, and the read at the start of the next turn leans on that. In between the loop's own test leaves the counter one number.
function sum(list, unused, start) {
  let turns = 0, total = 0, still = 0, value = 0;
  for (let i = start; i < 3; ) {
    if (++turns > 9) break;
    value = list[i]; total += value;
    total += i > 100 ? 1 : 2;
    const before = i++;
    for (let j = i; j < i + 2; j++) { value = list[j & 3]; total = (total + (value | 0)) | 0; }
    for (let k = before - 1; k < before; k++) { value = list[k - 1]; total += value; }
    value = list[i]; total += value;
    value = list[before & 3]; total += value;
  }
  return [total, still, value];
}
console.log([[0, 1].map(() => ((list) => String(sum(list, { n: 1, b: 3, m: [0.5, 2] }, 1)))(new Float32Array(5))).join(";"), ((list) => String(sum(list, { n: 1, b: 3, m: [1, 2] }, 1)) + "/" + String(list))(new Float32Array(4))].join(" "));
