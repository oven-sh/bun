// `[...list]` of a number[] allocates double storage. The list itself may store boxed values, NaN, -0 or a hole, and behind a cast something that is not a number.
// The copy holds what iterating the list yields: undefined for a hole.
const mapped: number[] = [1, 2, 3, 4, 5, 6, 7, 8].map(x => x + 1);
const halves: number[] = [1, 2, 3, 4].map(x => x + 0.5);
const made: number[] = Array.from({ length: 5 }, (_, k) => k * 3);
const mixed: number[] = [1, 2.5, 3].map(x => (x === 3 ? NaN : x));
const zeros: number[] = [0, 1].map(x => (x ? 1 : -0));
const withHole: number[] = [1, 2, 3, , 5, 6, 7, 8] as number[];
const halvesWithHole: number[] = [1.5, , 3.5] as number[];
const valuesWithHole: number[] = [1, 2, 3].map(x => x);
delete valuesWithHole[1];
const notNumbers: number[] = [1, 2, 3].map(x => (x === 2 ? "two" : x)) as number[];
const nothing: number[] = [].map(x => x);
const long: number[] = Array.from({ length: 100 }, (_, k) => (k === 70 ? 0.25 : k));

function show(list: (number | undefined)[]): string {
  let text = list.length + ":";
  for (let index = 0; index < list.length; index++) text += (index in list ? (Object.is(list[index], -0) ? "-0" : String(list[index])) : "hole") + ",";
  return text;
}
function sum(list: number[]): number {
  let total = 0;
  for (let index = 0; index < list.length; index++) total += list[index] ?? 0;
  return total;
}
const sources = { mapped, halves, made, mixed, zeros, withHole, halvesWithHole, valuesWithHole, notNumbers, nothing, long };
for (let round = 0; round < 3; round++) {
  for (const [name, source] of Object.entries(sources)) {
    const copy = [...source];
    const twice = [...source, ...source];
    const behind = [round + 0.5, ...source, round];
    const whole = [round, ...source];
    if (round === 2) console.log(name, show(copy), show(twice).length, show(behind), show(whole), sum(copy), sum(twice), copy === source);
  }
}
function copyOfMapped(i: number): number {
  const copy = [...mapped];
  return (copy[i & 3] ?? 0) + (copy[2] ?? 0);
}
function copyWithHole(i: number): number {
  const copy = [...withHole];
  return (copy[i & 3] ?? 0) + (copy[2] ?? 0);
}
let total = 0;
for (let i = 0; i < 2000; i++) total += copyOfMapped(i) + copyWithHole(i);
console.log(total);
