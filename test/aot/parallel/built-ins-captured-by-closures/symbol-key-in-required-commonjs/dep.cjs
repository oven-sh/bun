const key = Symbol.for("made.up");
const g = globalThis;
class Emitter {
  constructor() {
    if (g[key]) return g[key];
    g[key] = this;
  }
}
exports.same = () => new Emitter() === new Emitter();
