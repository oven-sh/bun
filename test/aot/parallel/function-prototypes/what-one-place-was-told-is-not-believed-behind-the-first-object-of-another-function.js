// Two constructor functions share two places in one turn of a loop. What the places look for lies on the prototype object of one alone.
// The first object of the other is made between the two: what the first place was told says nothing about that object.
const never = process.argv.length > 99;
const pairs = JSON.parse(process.argv[2] ?? "[[1,0],[0,1],[1,1]]");
function size() {
  return this.x + 100;
}
function Plain(x) {
  this.x = x;
}
function Sized(x) {
  this.x = x;
}
Object.defineProperty(Sized.prototype, "size", { get: size });
if (never) Object.defineProperty(Plain.prototype, "size", { get: size });
console.log(new Sized(1).size);
const all = [];
const seen = [];
for (const pair of pairs) {
  const first = pair[0] === 0 ? new Plain(0) : new Sized(1);
  all.push(first);
  seen.push(first.size);
  const second = pair[1] === 0 ? new Plain(0) : new Sized(1);
  all.push(second);
  seen.push(second.size);
  console.log(seen.length);
}
console.log(JSON.stringify(all), String(seen));
