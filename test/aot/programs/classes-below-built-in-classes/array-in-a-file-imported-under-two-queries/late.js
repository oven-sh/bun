globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
class Late extends Array {
  static count = 0;
  static next() {
    return ++Late.count;
  }
}
export default Late;
