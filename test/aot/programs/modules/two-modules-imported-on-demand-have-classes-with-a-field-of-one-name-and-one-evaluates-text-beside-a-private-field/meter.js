function Reading(level) {
  this.level = level;
}
console.log(new Reading(3).level);

BigUint64Array();
const Meter = class {
  level = 1;
  #count = 1;
  static get total() {
    function* each() {
      yield eval("1 + 1");
    }
    return [...each()];
  }
};
console.log(Meter.total);
