// `first: source.size` is checked against the type that the other literal of the same shape gives the member, and the check may fail. What hangs on the checked value loses what was proven of it,
// and the number that is read out of the object is one of those. The list that is made of it still has the storage that its readers expect.
const source = { first: "1.5".repeat(2), size: [], flag: 100, tag: [7] };
const taker = { first: source.size, size: typeof 7, flag: "été".charCodeAt(3) | 0, tag: [] };
const alias = taker;
const holder = { text: taker.size + taker, tag: [taker.flag] };
function total(list: number[]): number {
  let sum = 0;
  for (let index = 0; index < list.length; index++) sum += list[index];
  return sum;
}
console.log(
  total(holder.tag),
  holder.tag.reduce((a, b) => a + b, 10),
  holder.tag.map(item => item * 2).join(),
);
holder.tag.map(item => String) + "]";
Array.from({ length: 1 }, () => {
  Object.defineProperty(source, "0~".slice(), { value: alias.flag << 16 });
});
