class Box {
  value = 1;
}

function double(box: Box, depth: number): void {
  if (depth > 0) return double(box, depth - 1);
  box.value *= 2;
}

function grow(box: Box, turns: number, depth: number): number {
  if (depth > 0) return grow(box, turns, depth - 1);
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    total += box.value;
    double(box, 2);
  }
  return total;
}

const boxes = [new Box(), new Box()];
console.log(grow(boxes[0], 10, 2), grow(boxes[1], 3, 2), boxes[0].value);
