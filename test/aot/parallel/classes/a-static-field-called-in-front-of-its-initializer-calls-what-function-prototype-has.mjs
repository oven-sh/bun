class Peg {
  constructor(size) {
    this.size = size;
  }
}
let kept;
const see = () => kept;
class Crate {
  static {
    kept = Crate.toString();
  }
  static toString = () => new Peg(1);
}
for (let turn = 0; turn < 3; turn++) see();
console.log(typeof see(), typeof see().size, Crate.toString().size);
class Shelf {
  static early = Shelf.hasOwnProperty("early");
  static hasOwnProperty = () => new Peg(2);
}
console.log(typeof Shelf.early, Shelf.hasOwnProperty("early").size);
class Rack {
  static early = Rack.bind(null);
  static bind = () => new Peg(3);
}
console.log(typeof Rack.early, Rack.bind(null).size);
