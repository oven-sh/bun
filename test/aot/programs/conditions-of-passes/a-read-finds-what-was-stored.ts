// A field that every object of a type is born with is surely found by a read, and what the read finds is what was stored.
type Pair = { left: number; right: string };

function leftOf(pair: Pair): number {
  const left = pair.left;
  return left + 1;
}

function rightOf(pair: Pair): string {
  const right = pair.right;
  return right + "!";
}

const first: Pair = { left: 1, right: "one" };
const second: Pair = { left: 2, right: "two" };
console.log(leftOf(first), rightOf(first), leftOf(second), rightOf(second));
