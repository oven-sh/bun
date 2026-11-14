class Heir extends Array {
  get length() {
    return 100;
  }
  set length(value) {}
  map() {
    return "own map";
  }
}
module.exports = Heir.of(1, 2, 3);
