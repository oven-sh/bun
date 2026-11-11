class Box { constructor() { this.held = 1; } }
const box = new Box();
class Base {
  constructor() {
    return new Proxy({}, {
      defineProperty(target, key, descriptor) {
        box.held += 1;
        return Reflect.defineProperty(target, key, descriptor);
      },
    });
  }
}
class Heir extends Base {
  first = box.held;
  second = box.held;
  third = box.held;
}
function make() { const before = box.held; const made = new Heir(); return before * 1000000 + made.first * 10000 + made.second * 100 + made.third - box.held; }
let sum = 0;
for (let turn = 0; turn < 30; ++turn) { box.held = 1; sum += make(); }
console.log(sum, box.held);
