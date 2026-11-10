class Base {
  constructor() {
    return new Proxy({}, { defineProperty() { return false; } });
  }
}
class Heir extends Base { field = 1; }
let caught = 0;
for (let turn = 0; turn < 50; ++turn) {
  try { new Heir(); } catch (error) { caught += error instanceof TypeError ? 1 : 1000; }
}
console.log(caught);
