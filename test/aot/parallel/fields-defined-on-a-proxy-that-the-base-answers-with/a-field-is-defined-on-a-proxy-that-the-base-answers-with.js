let counter = 0;
class Base {
  constructor() {
    return new Proxy({}, {
      defineProperty(target, key, descriptor) {
        counter++;
        return Reflect.defineProperty(target, key, descriptor);
      },
    });
  }
}
class Heir extends Base {
  a = 1;
  b = counter;
  c = counter;
}
let sum = 0;
for (let turn = 0; turn < 2000; ++turn) {
  const made = new Heir();
  sum += made.b * 3 + made.c;
}
const last = new Heir();
console.log(last.a, last.b, last.c, counter, sum);
