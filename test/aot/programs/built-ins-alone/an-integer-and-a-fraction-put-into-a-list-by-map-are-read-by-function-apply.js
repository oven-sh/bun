const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
function use(first, second) {
  console.log(first + 1, second + 1);
}
use.apply(null, held);
