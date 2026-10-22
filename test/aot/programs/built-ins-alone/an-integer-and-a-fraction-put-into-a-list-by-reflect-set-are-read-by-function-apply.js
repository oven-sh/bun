const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use.apply(null, held);
