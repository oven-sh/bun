const keyOfX: string = JSON.parse('"x"');
const keyOfExtra: string = JSON.parse('"extra"');
const keyOfZero: string = JSON.parse('"0"');
const turns: number = JSON.parse("3");
type Pair = { x: number; y: number };
function readFirst(pair: Pair) {
  return (pair as any)[0];
}
function empty(pair: Pair, key: string) {
  delete (pair as any)[key];
}
const pair: Pair = { x: 1, y: 2 };
(pair as any)[keyOfZero] = "first";
console.log(readFirst(pair), Object.keys(pair).join());
empty(pair, keyOfZero);
console.log(readFirst(pair), Object.keys(pair).join(), new Map([[1, readFirst(pair)]]).get(1));
