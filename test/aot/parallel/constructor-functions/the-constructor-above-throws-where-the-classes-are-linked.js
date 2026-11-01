// `Derived.prototype = new Base()` where Base throws, and where it keeps a trace: the frame is that of a construction.
const frames = error =>
  error.stack
    .split("\n")
    .slice(0, 4)
    .map(line => line.trim().replace(/\(?[^\s(]*[\\/]/, "").replace(/\)$/, ""))
    .join(" | ");
function Base(options) {
  this.trace = new Error("kept");
  this.name = options.name;
}
function Derived() {}
let said = "nothing";
try {
  Derived.prototype = new Base();
} catch (error) {
  said = error.constructor.name + ": " + error.message + " || " + frames(error);
}
console.log(said);
console.log(Derived.prototype.constructor === Derived);
Derived.prototype = new Base({ name: "given" });
console.log(frames(Derived.prototype.trace));
console.log(frames(new Base({ name: "plain" }).trace));
