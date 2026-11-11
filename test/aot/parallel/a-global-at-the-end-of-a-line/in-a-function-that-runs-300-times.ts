// @ts-nocheck
let count = 0;
function step(by: number) {
  global
  {
    count += by;
  }
  return count;
}
let last = 0;
for (let i = 0; i < 300; i++) last = step(2);
console.log(last, count);
