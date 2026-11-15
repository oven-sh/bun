const keyOfX: string = JSON.parse('"x"');
const keyOfExtra: string = JSON.parse('"extra"');
const keyOfZero: string = JSON.parse('"0"');
const turns: number = JSON.parse("3");
type Pair = { x: number; y: number };
function readExtra(pair: Pair) {
  return (pair as any).extra;
}
function empty(pair: Pair, key: string) {
  delete (pair as any)[key];
}
const pair: Pair = { x: 1, y: 2 };
(pair as any)[keyOfExtra] = "here";
console.log(readExtra(pair), Object.keys(pair).join());
empty(pair, keyOfExtra);
console.log(readExtra(pair), Object.keys(pair).join(), new Set([readExtra(pair)]).size, "extra" in pair);
