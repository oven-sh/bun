class Box {
  constructor(n) { this.n = n; }
  twice() { return this.n + this.n; }
}
exports.Box = Box;
exports.one = () => new Box(1).twice();
