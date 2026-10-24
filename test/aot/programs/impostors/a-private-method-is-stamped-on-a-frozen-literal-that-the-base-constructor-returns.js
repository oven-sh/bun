const frozen = Object.freeze({});
class Base {
  constructor() {
    return frozen;
  }
}
class Stamper extends Base {
  #m() {
    return "stamped";
  }
  static access(o) {
    return o.#m();
  }
}
new Stamper();
console.log(Stamper.access(frozen));
