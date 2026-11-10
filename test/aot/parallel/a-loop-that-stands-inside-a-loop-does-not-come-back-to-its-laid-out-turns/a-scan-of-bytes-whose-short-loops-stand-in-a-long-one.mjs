// STATISTIC: UnrolledLoopsWithReentry = 1
const n = Number(process.argv[2] ?? 3);
const made = [...new TextEncoder().encode(JSON.stringify([{ id: 10, name: 'one "two"', list: [1, 22, 333] }, { id: 11, name: 'three', deep: { a: -4.5, b: 'x' } }, { id: 12, name: 'four', on: true }]))];
function job(d, turn) {
  let at = turn & 1;
  let strings = 0;
  let numbers = 0;
  let marks = 0;
  let hash = 0;
  while (at < d.length) {
    const c = d[at];
    if (c === 34) {
      at++;
      while (d[at] !== 34) {
        if (d[at] === 92) at++;
        hash = (Math.imul(hash, 31) + d[at]) | 0;
        at++;
      }
      at++;
      strings++;
    } else if (c === 45 || (c >= 48 && c <= 57)) {
      let v = 0;
      while (at < d.length && (d[at] === 45 || d[at] === 46 || (d[at] >= 48 && d[at] <= 57))) v = v * 10 + d[at++] - 48;
      numbers++;
      hash = (hash + v) | 0;
    } else {
      at++;
      marks++;
    }
  }
  return (hash + strings * 3 + numbers * 5 + marks) | 0;
}
const data = Uint8Array.from(made);
let sum = 0;
for (let turn = 0; turn < n; turn++) sum = (Math.imul(sum, 31) + job(data, turn)) | 0;
console.log(sum);
