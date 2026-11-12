function* rows() {
  yield 1;
  yield 2;
}
class Page {
  *[Symbol.iterator]() {
    yield 3;
  }
}
exports.rows = [...rows()].join();
exports.page = Math.max(...new Page(), ...rows());
exports.total = () => [...rows(), ...new Page()].length;
