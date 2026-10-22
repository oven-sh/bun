export default class Late extends Map {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
