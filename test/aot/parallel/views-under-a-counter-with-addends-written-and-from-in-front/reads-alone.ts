function total(a: Int32Array, start: number, end: number): number {
  let ahead = 2, sum = 0;
  const from = start | 0, to = end | 0;
  for (let i = from; i < to; i++) { sum = (sum + (a[i + ahead] | 0)) | 0; sum = (sum + (a[i + 2] | 0)) | 0; sum = (sum + (a[i + 1] | 0)) | 0; }
  return sum;
}
const room = new ArrayBuffer(48);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4);
for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; }
const given: number[] = JSON.parse("[0, 2, -2, 2]");
console.log(total(middle, given[0]!, given[1]!), total(middle, given[2]!, given[3]!));
