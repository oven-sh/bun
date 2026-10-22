const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
