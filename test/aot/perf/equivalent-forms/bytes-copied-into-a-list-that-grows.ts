// The bytes of a typed array go into a list, which has to grow every so often. Whether the counter lies inside the array is asked in front of each loop, whichever way it counts,
// and the turn in which the list grows is the only one that costs more. ../equivalent-forms.test.ts holds each pair together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

function fromTheFirstOn(bytes: Uint8Array): number {
  const list: number[] = [];
  for (let i = 0; i < bytes.length; i++) list.push(bytes[i]!);
  return list.length + list[1]!;
}
function fromTheLastOn(bytes: Uint8Array): number {
  const list: number[] = [];
  for (let i = bytes.length - 1; i >= 0; i--) list.push(bytes[i]!);
  return list.length + list[1]!;
}
function testedAbove(bytes: Uint8Array, n: number): number {
  const list: number[] = [];
  for (let i = 0; i < n; i++) list.push(bytes[i]!);
  return list.length + list[1]!;
}
function testedBelow(bytes: Uint8Array, n: number): number {
  const list: number[] = [];
  let i = 0;
  do list.push(bytes[i]!);
  while (++i < n);
  return list.length + list[1]!;
}
function inPairsByOneCounter(bytes: Uint8Array): number {
  const list: number[] = [];
  const last = bytes.length - 1;
  for (let i = 0; i < last - i; i++) list.push(bytes[i]! + bytes[last - i]!);
  return list.length + list[1]!;
}
function inPairsByTwoCounters(bytes: Uint8Array): number {
  const list: number[] = [];
  let low = 0;
  let high = bytes.length - 1;
  while (low < high) list.push(bytes[low++]! + bytes[high--]!);
  return list.length + list[1]!;
}

const bytesOf = (n: number) => new Uint8Array(n).fill(3);
const loops: Record<string, (n: number) => number> = {
  "from the first on": n => fromTheFirstOn(bytesOf(n)),
  "from the last on": n => fromTheLastOn(bytesOf(n)),
  "up to a count, tested above": n => testedAbove(bytesOf(n), n),
  "up to a count, tested below": n => testedBelow(bytesOf(n), n),
  "in pairs, by one counter": n => inPairsByOneCounter(bytesOf(n * 2)),
  "in pairs, by two counters that meet": n => inPairsByTwoCounters(bytesOf(n * 2)),
};

if (which) console.log(which, loops[which]!(rounds));
else for (const name in loops) console.log(name, loops[name]!(rounds), loops[name]!(3), loops[name]!(9));
