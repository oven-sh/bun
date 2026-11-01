// Two constructor functions share a place in a loop. What the place looks for lies on the prototype object of one alone, and that one has had an object already.
// The first object of the other is made inside the loop: what was asked about the two before that object was there says nothing about it.
const never = process.argv.length > 99;
const kinds = JSON.parse(process.argv[2] ?? "[0,1,0,1]");
const taken = [];
function take(value) {
  taken.push(value);
}
function Plain(x) {
  this.x = x;
}
function Watched(x) {
  this.x = x;
}
Object.defineProperty(Watched.prototype, "y", { set: take });
if (never) Object.defineProperty(Plain.prototype, "y", { set: take });
new Watched(1).y = 1;
const all = [];
for (const kind of kinds) {
  const object = kind === 0 ? new Plain(kind) : new Watched(kind);
  all.push(object);
  object.y = 5;
}
console.log(JSON.stringify(all), JSON.stringify(taken));
