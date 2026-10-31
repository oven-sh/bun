// Flags: --aot-disable=pass:SinkAllocations
// Two constructor functions share a place in a loop. What the place looks for lies on the prototype object of one alone, and that one has had an object already.
// The first object of the other is made inside the loop: what was asked about the two before that object was there says nothing about it.
const never = process.argv.length > 99;
const kinds = JSON.parse(process.argv[2] ?? "[0,1,0,1]");
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
for (const kind of kinds) {
  const object = kind === 0 ? new Plain(kind) : new Sized(kind);
  all.push(object);
  seen.push(object.size);
}
console.log(JSON.stringify(all), String(seen));
