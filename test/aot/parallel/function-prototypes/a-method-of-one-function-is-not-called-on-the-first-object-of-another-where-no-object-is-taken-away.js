// Flags: --aot-disable=pass:SinkAllocations
// Two constructor functions share a place in a loop. What the place looks for lies on the prototype object of one alone, and that one has had an object already.
// The first object of the other is made inside the loop: what was asked about the two before that object was there says nothing about it.
const never = process.argv.length > 99;
const always = process.argv.length < 99;
function twice() {
  return this.x * 2;
}
function Plain(x) {
  this.x = x;
}
function Doubled(x) {
  this.x = x;
}
Doubled.prototype.twice = twice;
if (never) Plain.prototype.twice = twice;
console.log(new Doubled(1).twice());
const kept = [];
function run() {
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    const object = always ? new Plain(8) : new Doubled(8);
    kept[i & 3] = object;
    sum += object.twice();
  }
  return sum;
}
try {
  console.log(run());
} catch (error) {
  console.log(error instanceof TypeError ? "TypeError" : "another error");
}
