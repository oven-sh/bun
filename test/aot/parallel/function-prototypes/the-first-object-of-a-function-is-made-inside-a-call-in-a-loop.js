// A function that is not copied into its caller makes an object of one of two constructor functions. What the caller looks for lies on the prototype object of one alone.
// The first object of the other is made inside the call: what was asked about the two before the call says nothing about it.
const never = process.argv.length > 99;
const kinds = JSON.parse(process.argv[2] ?? "[1,1,0,1,0]");
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
function make(kind, depth) {
  if (depth > 0) return make(kind, depth - 1);
  return kind === 0 ? new Plain(0) : new Sized(1);
}
function run() {
  for (const kind of kinds) {
    const object = make(kind, 3);
    all.push(object);
    seen.push(object.size);
  }
}
run();
console.log(JSON.stringify(all), String(seen));
