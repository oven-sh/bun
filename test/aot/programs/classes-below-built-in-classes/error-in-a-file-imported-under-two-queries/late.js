globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
class Late extends Error {
  static count = 0;
  static next() {
    return ++Late.count;
  }
}
export default Late;
