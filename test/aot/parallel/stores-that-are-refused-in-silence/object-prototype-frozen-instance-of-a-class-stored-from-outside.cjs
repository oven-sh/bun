Object.freeze(Object.prototype);
class Box { constructor() { this.size = 1; } }
function fill(box) { box.toString = 0; box.size = 2; return box; }
const b = fill(new Box());
console.log(typeof b.toString, b.size, Object.keys(b).join());
