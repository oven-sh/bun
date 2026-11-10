// Under: --aot-check=Validate: the same on a prototype object
class Kind { get size() { return 1; } }
class Heir extends Kind {}
class Answers { constructor(given) { return given; } }
class Stamp extends Answers { size = 2; }
new Stamp(Kind.prototype);
function read(object) { return object.size; }
console.log(read(new Kind()), read(new Heir()));
