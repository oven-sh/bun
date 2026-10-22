globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
class Late extends Promise {
  static count = 0;
  static next() {
    return ++Late.count;
  }
}
module.exports = Late;
