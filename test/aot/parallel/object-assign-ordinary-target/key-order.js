// The copy lists its keys in the order in which the source got them, not in the order of the source's layout.
function make(first) {
  const source = {};
  if (first) {
    source.alpha = 1;
    source.beta = 2;
    source.gamma = 3;
  } else {
    source.gamma = 3;
    source.alpha = 1;
    source.beta = 2;
  }
  return source;
}
class Point {
  constructor(swap) {
    if (swap) {
      this.y = 2;
      this.x = 1;
    } else {
      this.x = 1;
      this.y = 2;
    }
  }
}
const proto = { kind: "p" };
for (let round = 0; round < 6; round++) {
  console.log(Object.keys(Object.assign(Object.create(proto), make(round & 1))).join());
  console.log(Object.keys(Object.assign(Object.create(proto), new Point(round & 1))).join());
  const again = make(true);
  delete again.alpha;
  again.alpha = 9;
  console.log(JSON.stringify(Object.assign(Object.create(proto), again)));
}
