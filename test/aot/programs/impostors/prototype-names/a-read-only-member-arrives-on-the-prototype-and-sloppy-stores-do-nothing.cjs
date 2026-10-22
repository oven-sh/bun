// Untyped sloppy code. A read-only data property, then a getter without a setter, arrive on the prototype of a constructor function
// under the name of a property that instances get late. A store to an instance without it is ignored in silence.
function Options(name) {
  this.name = name;
}
function read(options) {
  return options.depth;
}
function write(options, value) {
  options.depth = value;
  return options.depth;
}
function describe(options) {
  return read(options) + " " + ("depth" in options) + " " + options.hasOwnProperty("depth") + " [" + Object.keys(options) + "]";
}
console.log("sloppy:", (function () { return this !== undefined; })());

var sum = 0;
for (var i = 0; i < 3000; i++) {
  var options = new Options("o");
  sum += read(options) === undefined ? 1 : 0;
  sum += write(options, i & 7);
}
console.log("warm", sum);

var empty = new Options("empty");
var filled = new Options("filled");
write(filled, 2);
Object.defineProperty(Options.prototype, "depth", { value: 9, writable: false, configurable: true });
var fresh = new Options("fresh");
console.log("read-only:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log("stores:", write(empty, 1), write(filled, 3), write(fresh, 4), (empty.depth += 1), empty.depth++, ++empty.depth);
console.log("after:", describe(empty), "|", describe(filled), "|", describe(fresh));
Object.defineProperty(Options.prototype, "depth", { get: function () { return this.name.length; }, configurable: true });
console.log("a getter:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log("stores:", write(empty, 1), write(filled, 5), write(fresh, 4), write(new Options("ab"), 6));
console.log("after:", describe(empty), "|", describe(filled), "|", describe(fresh));
delete Options.prototype.depth;
console.log("gone again:", describe(empty), "|", write(empty, 7), describe(empty), "|", describe(new Options("n")));
