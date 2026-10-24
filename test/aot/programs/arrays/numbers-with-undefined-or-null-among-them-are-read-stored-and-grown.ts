const withUndefined: (number | undefined)[] = [1, undefined, 3, undefined];
const withNull: (number | null)[] = [1, null, 2.5, null];
const filledLater: (number | undefined)[] = [];
const onlyNumbersSoFar: (number | undefined)[] = [1, 2, 3];
const ofLength: (number | null)[] = new Array(4);

function sum(list: (number | undefined | null)[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i] ?? 10;
  return total;
}

function describe(list: (number | undefined | null)[]): string {
  return `${list.length}: ${list.map(value => String(value)).join(",")} | ${Object.keys(list).join("")} | ${sum(list)}`;
}

function maybe(i: number): number | undefined {
  return i % 3 === 0 ? undefined : i;
}

for (let i = 0; i < 8; i++) filledLater.push(maybe(i));
console.log(describe(withUndefined), describe(withNull), describe(filledLater), describe(onlyNumbersSoFar), describe(ofLength));

withUndefined[1] = 0.5;
withUndefined[6] = -0;
withNull[0] = NaN;
withNull.length = 2;
onlyNumbersSoFar[1] = maybe(3);
onlyNumbersSoFar.unshift(2 ** 31);
ofLength[2] = null;
ofLength[0] = 7;
console.log(describe(withUndefined), describe(withNull), describe(onlyNumbersSoFar), describe(ofLength));
console.log(Object.is(withUndefined[6], -0), 5 in withUndefined, 1 in ofLength, withUndefined.indexOf(undefined), withUndefined.includes(undefined), ofLength.includes(undefined as never));
console.log(withUndefined.slice().sort().map(String).join(), [...withNull, ...filledLater].reverse().map(String).join(), JSON.stringify([withUndefined, withNull, ofLength]));
