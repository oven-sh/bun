// The species is a constructor function whose instances are no arrays: native code defines the elements and, in some methods, stores a length beside the fields of the constructor.
const log = [];
function Made(length) { this.tag = 7; this.given = length; this.next = null; }
Made.prototype.describe = function () { return this.tag + "/" + this.given + "/" + this.length + "/" + Object.keys(this).join(); };
const source = [[1], 2, 3]; source.constructor = { [Symbol.species]: Made };
for (const made of [source.flat(), source.slice(1), source.concat(9), source.map(x => x), source.filter(() => true)]) { log.push(made instanceof Made, made.describe(), made[0] === undefined ? "none" : JSON.stringify(made[0])); made.next = made; log.push(made.next.tag); }
console.log(log.join("; "));
