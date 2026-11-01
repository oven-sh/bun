// COUNT: counter:KeyOrdersStoredOutOfLine <= 180000
// COUNT: counter:CompiledStructuresMade <= 45000
type Eight = { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number };
type Other = { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; other?: number };
type Name = keyof Eight;
const letters: Name[] = ["a", "b", "c", "d", "e", "f", "g", "h"];
function order(number: number): Name[] {
  const left = [...letters];
  const out: Name[] = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
function written(names: Name[], seed: number): Eight {
  const made: Eight = {};
  for (const name of names) made[name] = seed + name.charCodeAt(0);
  return made;
}
function writtenToOther(names: Name[], seed: number): Other {
  const made: Other = {};
  for (const name of names) made[name] = seed + name.charCodeAt(0);
  return made;
}
function hash(text: string, into: number): number {
  for (let i = 0; i < text.length; i++) into = (Math.imul(into, 31) + text.charCodeAt(i)) | 0;
  return into;
}
function sumOf(list: object[]): number {
  let sum = 0;
  for (const value of list) sum = hash(JSON.stringify(value), sum);
  return sum;
}

const everyOrderOnce: Eight[] = [];
for (let at = 0; at < 30000; at++) everyOrderOnce.push(written(order(at), at));
console.log(sumOf(everyOrderOnce), sumOf(everyOrderOnce.map((value): Eight => ({ ...value }))), sumOf(everyOrderOnce.map(value => Object.keys(value))));

const fewOrdersOften: Eight[] = [];
for (let at = 0; at < 40000; at++) fewOrdersOften.push(written(order(30011 + (at % 20) * 499), at));
console.log(sumOf(fewOrdersOften), sumOf(fewOrdersOften.map((value): Eight => ({ ...value }))));

const otherType: Other[] = [];
for (let at = 0; at < 6000; at++) otherType.push(writtenToOther(order(at * 5), at));
for (let at = 0; at < 40000; at++) otherType.push(writtenToOther(order(30013 + (at % 20) * 503), at));
console.log(sumOf(otherType));

const onceAgain: Eight[] = [];
for (let at = 30000; at < 40320; at++) onceAgain.push(written(order(at), at));
console.log(sumOf(onceAgain));

const first = everyOrderOnce[29999];
const copy: Eight = { ...first };
delete first.c;
first.c = 1;
copy.a = 2;
console.log(JSON.stringify([first, copy, fewOrdersOften[39999], otherType[45999], onceAgain[10319]]));
