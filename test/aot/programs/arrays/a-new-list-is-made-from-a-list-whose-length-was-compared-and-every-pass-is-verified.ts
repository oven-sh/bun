// The length of a list is compared with zero, and behind that a new list is made from what the first one holds.
function pairOf(values: unknown[]): unknown[] {
  let pair;
  if (values.length === 0) {
    pair = [{}, null];
    return pair;
  }
  const first = values[0];
  const last = values[values.length - 1];
  if (typeof last !== "function") pair = [first, null];
  else pair = [first, last];
  return pair;
}

function double(value: number) {
  return value * 2;
}

console.log(JSON.stringify(pairOf([])));
console.log(JSON.stringify(pairOf([1])));
console.log(JSON.stringify(pairOf(["a", "b"])));
const [first, last] = pairOf([21, double]);
console.log(first, last === double, (last as typeof double)(first as number));
