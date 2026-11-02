let calls = 0;
exports.count = function () {
  return ++calls + (this === undefined ? 0 : 100);
};
exports.box = { n: 1, list: [1, 2] };
exports.Point = class Point {
  constructor(x) {
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
};
exports.read = () => exports.box.n + ":" + exports.box.list.length + ":" + calls + ":" + Object.keys(exports.box).join();
exports.c = 1;
exports.bump = () => (exports.c += 1);
