// A long text is put together, then a shorter one that only one of two paths reads. On the other path elements of a list that nothing else holds are read on both sides of the place where the text ends.
// Env: BUN_JSC_collectContinuously=1
// Env: BUN_JSC_forceDidDeferGCWork=1
// Env: BUN_JSC_useZombieMode=1
// Env: BUN_JSC_scribbleFreeCells=1
class Box {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

const pending: Box[][] = [];

function lengthOfText(count: number): number {
  let text = "";
  for (let i = 0; i < count; i++) text += "0123456789";
  return text.length;
}

function sumBesideText(count: number, isRead: boolean): number {
  let text = "";
  for (let i = 0; i < count; i++) text += "0123456789";
  const boxes = pending.pop()!;
  const first = boxes[0].value;
  if (isRead) return text.length + first;
  return first + boxes[1].value + boxes[2].value + boxes[3].value;
}

let sum = 0;
let lengths = 0;
for (let round = 0; round < 200; round++) {
  lengths += lengthOfText(60000);
  pending.push([new Box(round), new Box(round + 1), new Box(round + 2), new Box(round + 3)]);
  sum += sumBesideText(10000, round % 50 === 49);
}
console.log(sum, lengths);
