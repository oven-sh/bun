// One turn in many takes a long way, which reads the list, cuts it, pushes other elements and reads it again. The other turns read one element each.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(list: number[], n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = list[j & 7];
    sum = mix(sum, e === undefined ? -1000 : e);
    if (j === 17) {
      let t = sum | 0;
      t = ((t ^ 5) * 3 + list[0]!) | 0;
      t = ((t ^ 6) * 3 + j) | 0;
      t = ((t ^ 7) * 3 + j) | 0;
      t = ((t ^ 8) * 3 + j) | 0;
      t = ((t ^ 9) * 3 + j) | 0;
      t = ((t ^ 10) * 3 + j) | 0;
      t = ((t ^ 11) * 3 + list[6]!) | 0;
      t = ((t ^ 12) * 3 + j) | 0;
      t = ((t ^ 13) * 3 + j) | 0;
      t = ((t ^ 14) * 3 + j) | 0;
      t = ((t ^ 15) * 3 + j) | 0;
      t = ((t ^ 16) * 3 + j) | 0;
      t = ((t ^ 17) * 3 + list[4]!) | 0;
      t = ((t ^ 18) * 3 + j) | 0;
      t = ((t ^ 19) * 3 + j) | 0;
      t = ((t ^ 20) * 3 + j) | 0;
      t = ((t ^ 21) * 3 + j) | 0;
      t = ((t ^ 22) * 3 + j) | 0;
      t = ((t ^ 23) * 3 + list[2]!) | 0;
      t = ((t ^ 24) * 3 + j) | 0;
      t = ((t ^ 25) * 3 + j) | 0;
      t = ((t ^ 26) * 3 + j) | 0;
      t = ((t ^ 27) * 3 + j) | 0;
      t = ((t ^ 28) * 3 + j) | 0;
      list.length = 2;
      list.push(t & 255, 0.5);
      sum = mix(sum, t + list[3]! + list.length);
    }
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work([i, 1, 2, 3, 4, 5, 6, 7], 24));
console.log(total);
