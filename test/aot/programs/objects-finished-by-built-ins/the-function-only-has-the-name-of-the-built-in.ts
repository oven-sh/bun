interface Pair {
  left: number;
  right: number;
}
function build(): Pair[] {
  const Object = {
    assign(target: object, source: object) {
      return { ...source, left: -1, target };
    },
  };
  return [Object.assign({ left: 1 }, { right: 2 }) as unknown as Pair];
}
function sum(pair: Pair) {
  return pair.left + pair.right;
}
const [pair] = build();
console.log(sum(pair), Object.keys(pair).join(), JSON.stringify(pair));
