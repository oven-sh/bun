// An element read twice takes what the first read found only where nothing between them can change it. A store through another name of the list, a store of the next element, a call and a swap by hand each come between two reads. The values go back to where they came from, boxed or not.
function swapWhenBigger(list: number[], k: number): number {
  let swaps = 0;
  if (list[k]! > list[k + 1]!) {
    const held = list[k]!;
    list[k] = list[k + 1]!;
    list[k + 1] = held;
    swaps++;
  }
  return swaps + list[k]!;
}
function throughAnotherName(list: number[], same: number[], k: number): number {
  const first = list[k]!;
  same[k] = first + 1;
  return first * 100 + list[k]!;
}
function behindACall(list: number[], k: number, change: () => void): number {
  const first = list[k]!;
  change();
  return first * 100 + list[k]!;
}
function nextElement(list: number[], k: number): number {
  const first = list[k]!;
  list[k + 1] = first + 5;
  return first * 100 + list[k]! + list[k + 1]!;
}
function negatives(list: number[], k: number): number[] {
  const out: number[] = [];
  out[0] = list[k]!;
  out[1] = list[k]!;
  return out;
}
const results: unknown[] = [];
for (let round = 0; round < 3; round++) {
  const list = [9, 3, 7, -1, 2147483647, -2147483648];
  for (let end = list.length - 1; end > 0; end--) for (let k = 0; k < end; k++) results.push(swapWhenBigger(list, k));
  results.push(list.join());
  results.push(throughAnotherName(list, list, 1));
  results.push(behindACall(list, 2, () => {
    list[2] = 77;
  }));
  results.push(nextElement(list, 0));
  results.push(negatives(list, 0).join());
  const widened = [1, 2, 3];
  results.push(behindACall(widened, 0, () => {
    (widened as unknown as (number | string)[])[0] = "text";
  }) );
}
console.log(results.join(" "));
