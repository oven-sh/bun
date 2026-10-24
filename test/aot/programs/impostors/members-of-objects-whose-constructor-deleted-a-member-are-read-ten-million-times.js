function Pair() {
  this.x = 42;
  this.y = 1337;
  delete this.y;
}
const pairs = [];
for (let i = 0; i < 50; ++i) pairs.push(new Pair());
let sum = 0;
for (let round = 0; round < 200000; ++round) {
  for (let i = 0; i < pairs.length; ++i) {
    const pair = pairs[i];
    if (pair.y === undefined) sum += pair.x;
  }
}
console.log(sum);
