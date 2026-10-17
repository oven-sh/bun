// takes the remainder of a whole number over 2^31, a time in milliseconds, by 1000
const operations = 100;
const times: number[] = [];
for (let i = 0; i < operations; i++) times.push(1760000000000 + i * 977);
const thousand: number = [1000][0];
let total = 0;

kernel: {
  for (let i = 0; i < times.length; i++) total += times[i] % thousand;
}

console.log(total);
