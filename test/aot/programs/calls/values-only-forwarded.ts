interface Item {
  id: number;
  name: string;
}

let log = "";

function note(item: Item, tag: string): number {
  log += tag + item.id + ";";
  return item.id;
}

function noteTwo(a: Item, b: Item, tag: string): number {
  log += tag + a.name + b.name + ";";
  return a.id + b.id;
}

function handsOn(a: Item, b: Item, c: Item, d: string): number {
  const first = note(a, d);
  const second = note(b, d);
  const third = note(c, d);
  return first + second * 10 + third * 100;
}

function handsOnTwice(a: Item, b: Item, c: Item, d: string): number {
  return noteTwo(a, b, d) + noteTwo(b, c, d) * 3 + noteTwo(c, a, d) * 5 + noteTwo(a, c, d) * 7;
}

function readsBetweenCalls(a: Item, b: Item, c: Item, d: string): string {
  let out = a.name;
  note(a, d);
  out += b.name + a.id;
  note(b, d);
  out += c.name + b.id + a.name;
  note(c, d);
  return out + c.id + b.name + a.id + d;
}

function handsOnInALoop(items: Item[], extra: Item, tag: string, rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < items.length; i++) total += noteTwo(items[i], extra, tag) + round;
  }
  return total;
}

function returnsEarly(a: Item | undefined, b: Item, tag: string): number {
  if (!a) return -1;
  if (a.id > 100) return a.id;
  return note(a, tag) + note(b, tag);
}

function numbersHandedOn(a: number, b: number, c: number, d: number): number {
  return sum3(a, b, c) + sum3(b, c, d) * 2 + sum3(c, d, a) * 3 + sum3(d, a, b) * 4;
}

function sum3(x: number, y: number, z: number): number {
  log += ".";
  return x + y * 0.5 + z * 0.25;
}

const one: Item = { id: 1, name: "one" };
const two: Item = { id: 2, name: "two" };
const three: Item = { id: 3, name: "three" };
const big: Item = { id: 500, name: "big" };

console.log(handsOn(one, two, three, "h"), handsOnTwice(one, two, three, "t"));
console.log(readsBetweenCalls(one, two, three, "r"));
console.log(handsOnInALoop([one, two, three], big, "l", 3));
console.log(returnsEarly(undefined, one, "e"), returnsEarly(big, one, "e"), returnsEarly(two, three, "e"));
console.log(numbersHandedOn(1, 2.5, -3, 4e3), numbersHandedOn(0.1, 0.2, 0.3, 0.4));
console.log(log.length, log.slice(0, 80));
