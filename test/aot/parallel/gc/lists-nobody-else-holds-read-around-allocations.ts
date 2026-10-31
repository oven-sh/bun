// Loops read and store elements of lists that only a local variable holds, and make objects, lists, texts and closures in every turn, in line and in functions that they call.
// A collection may come at each of those. The lists, their storage and what they hold stay, and storage that a collection moves is read where it lies then.
type Entry = { weight: number; label: string };

let newest: Entry | null = null;

function remember(weight: number): void {
  newest = { weight, label: "w" + weight };
}

function entries(count: number): Entry[] {
  const list: Entry[] = [];
  for (let k = 0; k < count; k++) list.push({ weight: k, label: "e" + k });
  return list;
}

function fractions(count: number): number[] {
  const list: number[] = [];
  for (let k = 0; k < count; k++) list.push(k + 0.5);
  return list;
}

function integers(count: number): number[] {
  const list: number[] = [];
  for (let k = 0; k < count; k++) list.push(k * 3);
  return list;
}

function readsEntries(count: number): number {
  const list = entries(count);
  let sum = 0;
  for (let at = 0; at < list.length; at++) {
    const made = { weight: at, label: "m" };
    sum += list[at]!.weight + made.weight + list[at]!.label.length;
  }
  return sum;
}

function readsEntriesAroundCalls(count: number): number {
  const list = entries(count);
  let sum = 0;
  for (let at = 0; at < list.length; at++) {
    const before = list[at]!;
    remember(at);
    sum += before.weight + list[list.length - 1 - at]!.weight + newest!.label.length;
  }
  return sum;
}

function replacesEntries(count: number): number {
  const list = entries(count);
  for (let at = 0; at < list.length; at++) list[at] = { weight: list[at]!.weight * 2, label: list[at]!.label + "!" };
  let sum = 0;
  for (let at = 0; at < list.length; at++) sum += list[at]!.weight + list[at]!.label.length;
  return sum;
}

function readsFractions(count: number): number {
  const list = fractions(count);
  let sum = 0;
  for (let at = 0; at < list.length; at++) {
    const pair = [list[at]!, at];
    sum += pair[0]! + pair[1]! + list[list.length - 1 - at]!;
  }
  return sum;
}

function readsIntegers(count: number): number {
  const list = integers(count);
  let text = "";
  let sum = 0;
  for (let at = 0; at < list.length; at++) {
    text = "t" + list[at]!;
    const add = () => list[at]! + text.length;
    sum += add();
  }
  return sum;
}

function keepsEveryTenth(count: number): number {
  const kept: Entry[][] = [];
  let sum = 0;
  for (let round = 0; round < count; round++) {
    const list = entries(7 + (round & 15));
    if (round % 10 === 0) kept.push(list);
    for (let at = 0; at < list.length; at++) {
      remember(at);
      sum += list[at]!.weight;
    }
  }
  for (const list of kept) for (let at = 0; at < list.length; at++) sum += list[at]!.label.length;
  return sum;
}

for (let round = 0; round < 4; round++)
  console.log(readsEntries(400), readsEntriesAroundCalls(400), replacesEntries(400), readsFractions(400), readsIntegers(400), keepsEveryTenth(300));
