function nest(depth) {
  class Ring { static depth = depth; inner() { return depth; } }
  return depth ? [Ring, ...nest(depth - 1)] : [Ring];
}
const rings = nest(2);
console.log(rings.length, rings.map(R => R.depth).join(), rings.map(R => new R().inner()).join(), rings[0] === rings[1]);
