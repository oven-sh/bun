// One array pattern takes apart a String object in one call and a Set in another.
function swapFirstTwo(items: any): unknown[] {
  const [first, second] = items;
  return [second, first];
}
function splitHead(items: any): unknown[] {
  const [head, ...tail] = items;
  return [head, tail];
}
class Label extends String {}

for (const items of [new String("boxed"), new Set([1, 2, 3]), Object("text"), new Label("label")]) {
  console.log(JSON.stringify(swapFirstTwo(items)), JSON.stringify(splitHead(items)));
}

let current: any;
function storeText(): void {
  current = new String("stored");
}
function storeNumbers(seed: number): void {
  current = new Set([1, seed]);
}
function readCurrent(): unknown[] {
  const [first, second] = current;
  return [second, first];
}
storeText();
console.log(JSON.stringify(readCurrent()));
storeNumbers(7);
console.log(JSON.stringify(readCurrent()));
