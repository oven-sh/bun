class Crate {
  mass = 3;
  *[Symbol.iterator]() {
    yield this.mass;
  }
}
const crate = new Crate();
var steps = Symbol.iterator;
function take({ [steps]: got }) {
  console.log(typeof got);
}
take(crate);
