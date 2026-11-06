// `first` and `second` hand what they get to each other, and each hands a part of it down five levels that read four
// parts each: together more members than are followed for one parameter. Behind that `first` hands it to `run`, which
// calls it. So that it is called is known of all three parameters, whichever of them is looked at first.
export function first(value, turns) {
  let sum = level0(value.own);
  if (turns > 0) sum += second(value, turns - 1);
  return sum + run(value);
}

export function second(value, turns) {
  const sum = turns > 0 ? first(value, turns - 1) : 0;
  return sum + level0(value.other);
}

export function run(value) {
  return value();
}

export function level0(node) {
  return level1(node.north) + level1(node.east) + level1(node.south) + level1(node.west);
}

export function level1(node) {
  return level2(node.north) + level2(node.east) + level2(node.south) + level2(node.west);
}

export function level2(node) {
  return level3(node.north) + level3(node.east) + level3(node.south) + level3(node.west);
}

export function level3(node) {
  return level4(node.north) + level4(node.east) + level4(node.south) + level4(node.west);
}

export function level4(node) {
  return level5(node.north) + level5(node.east) + level5(node.south) + level5(node.west);
}

export function level5(node) {
  return node.size;
}

function grow(size) {
  let node = { size };
  for (let level = 0; level < 5; level++) node = { north: node, east: node, south: node, west: { ...node } };
  return node;
}

const called = Object.assign(() => 7, { own: grow(1), other: grow(2) });
console.log(first(called, 0), first(called, 1), first(called, 4), second(called, 3));

class Counter {
  own = grow(3);
  other = grow(0.5);
}
for (const value of [new Counter(), { own: grow(1), other: grow(1) }, { own: grow("a") }, null]) {
  try {
    console.log(first(value, 2));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
