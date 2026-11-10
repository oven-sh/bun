// STATISTIC: KnownInductionsUsed >= 18
// Lists that constants of the file hold, read in loops at a position under a mask: whole ones, ones shorter than the mask, ones with a hole, halves, objects; one that grows, shrinks and changes its kind between
// the loops; two in which a hole is made and filled again; and one made empty with room for eight and filled bit by bit. No length is written where the compiler sees it.
function turns(n: number): number {
  return process.argv.length > 99 ? 0 : n;
}
class Point {
  constructor(public x: number) {}
}
const whole = [1, 2, 3, 4, 5, 6, 7, 8];
const short = [1, 2, 3];
const holed: any = [1, 2, , 4, 5, 6, 7, 8];
const pierced = [1, 2, 3, 4, 5, 6, 7, 8];
const piercedHalves = [0.5, 1.5, 2.5, 3.5];
const halfFilled: number[] = new Array(8);
const halves = [0.5, 1.5, 2.5, 3.5];
const points = [new Point(1), new Point(2)];
const changes: number[] = [1, 2, 3, 4];

function sumOfWhole(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += whole[i & 7];
  return s;
}
function sumOfShort(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += short[i & 7];
  return s;
}
function sumOfHoled(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += holed[i & 7];
  return s;
}
function sumOfPierced(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += pierced[i & 7];
  return s;
}
function sumOfPiercedHalves(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += piercedHalves[i & 3];
  return s;
}
function sumOfHalfFilled(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += halfFilled[i & 7];
  return s;
}
function productOfHalves(n: number): number {
  let s = 1;
  for (let i = 0; i < n; i++) s *= halves[i & 3];
  return s;
}
function differenceOfHalves(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s -= halves[i & 7];
  return s;
}
function quotientOfShort(n: number): number {
  let s = 36;
  for (let i = 0; i < n; i++) s = s / short[i & 3];
  return s;
}
function sumOfPoints(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += points[i & 1].x;
  return s;
}
function sumOfChanges(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += changes[i & 7];
  return s;
}
function sumAtOnePlaceOfShort(n: number, place: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += short[place & 7];
  return s;
}
function sumAtOnePlaceOfChanges(n: number, place: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += changes[place & 7];
  return s;
}
function missingInShort(n: number): string {
  let missing = 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const found = short[i & 7];
    if (found === undefined) missing++;
    else s += found;
  }
  return missing + " missing, " + s;
}
function textOfShort(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += short[i & 3];
  return s;
}

console.log(sumOfWhole(turns(0)), sumOfWhole(turns(8)), sumOfWhole(turns(1000)));
console.log(sumOfShort(turns(3)), sumOfShort(turns(4)), sumOfShort(turns(1000)));
console.log(sumOfHoled(turns(2)), sumOfHoled(turns(3)), sumOfHoled(turns(1000)));
console.log(productOfHalves(turns(4)), productOfHalves(turns(9)), differenceOfHalves(turns(4)), differenceOfHalves(turns(5)));
console.log(quotientOfShort(turns(3)), quotientOfShort(turns(4)), sumOfPoints(turns(1001)));
console.log(missingInShort(turns(16)), textOfShort(turns(5)));
console.log(sumAtOnePlaceOfShort(turns(10), turns(1)), sumAtOnePlaceOfShort(turns(10), turns(5)), sumAtOnePlaceOfShort(turns(0), turns(5)));

console.log(sumOfChanges(turns(4)), sumOfChanges(turns(5)), sumAtOnePlaceOfChanges(turns(3), turns(3)), sumAtOnePlaceOfChanges(turns(3), turns(4)));
changes.push(5, 6, 7, 8);
console.log(sumOfChanges(turns(5)), sumOfChanges(turns(16)), sumAtOnePlaceOfChanges(turns(3), turns(4)));
changes.length = 2;
console.log(sumOfChanges(turns(2)), sumOfChanges(turns(3)));
changes[1] = 0.5;
changes[7] = 8;
console.log(sumOfChanges(turns(2)), sumOfChanges(turns(3)), changes.length, sumAtOnePlaceOfChanges(turns(3), turns(1)), sumAtOnePlaceOfChanges(turns(3), turns(5)), sumAtOnePlaceOfChanges(turns(3), turns(7)));

console.log(sumOfPierced(turns(100)), sumOfPiercedHalves(turns(100)));
delete pierced[5];
delete piercedHalves[3];
console.log(sumOfPierced(turns(5)), sumOfPierced(turns(6)), sumOfPierced(turns(100)), sumOfPiercedHalves(turns(3)), sumOfPiercedHalves(turns(100)));
pierced[5] = 6;
piercedHalves[3] = 3.5;
console.log(sumOfPierced(turns(100)), sumOfPiercedHalves(turns(100)));

console.log(sumOfHalfFilled(turns(1)));
halfFilled[0] = 1;
halfFilled[1] = 2;
halfFilled[7] = 8;
console.log(sumOfHalfFilled(turns(2)), sumOfHalfFilled(turns(3)), sumOfHalfFilled(turns(100)));
for (let i = 2; i < 7; i++) halfFilled[i] = i + 1;
console.log(sumOfHalfFilled(turns(100)));
