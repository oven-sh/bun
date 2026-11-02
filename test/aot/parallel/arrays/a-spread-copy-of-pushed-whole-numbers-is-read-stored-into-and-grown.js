// `[...list]` of a list that only whole numbers were pushed to: the copy is read, stored into, grown, emptied and copied again, and the list it came from stays as it was.
const whole = [];
for (let k = 0; k < 8; k++) whole.push(k);
const fractions = [];
for (let k = 0; k < 8; k++) fractions.push(k + 0.5);
const words = [];
for (let k = 0; k < 8; k++) words.push("w" + k);

function read(i) {
  const b = [...whole];
  return (b[i & 3] ?? 0) + (b[2] ?? 0);
}
function readPastTheEnd(i) {
  const b = [...whole];
  return String(b[i]) + "," + String(b[-1]) + "," + b.length;
}
function storeFraction(i) {
  const b = [...whole];
  b[i & 7] = 0.25;
  return b[i & 7] + b[(i + 1) & 7];
}
function storeWord(i) {
  const b = [...whole];
  b[i & 7] = "x";
  return b[i & 7] + b[(i + 1) & 7];
}
function storeNaN(i) {
  const b = [...whole];
  b[i & 7] = NaN;
  return String(b[i & 7]) + b[(i + 1) & 7];
}
function storeFarBehindTheEnd(i) {
  const b = [...whole];
  b[20 + (i & 1)] = 7;
  return b.length + ":" + String(b[12]) + ":" + (12 in b) + ":" + b[3];
}
function grow(i) {
  const b = [...whole];
  const c = [...b];
  c.push(i + 0.5);
  return c.length + ":" + c[8] + ":" + c[i & 7] + ":" + b.length;
}
function takeAway(i) {
  const b = [...whole];
  delete b[i & 7];
  return String(b[i & 7]) + ":" + ((i & 7) in b) + ":" + b[(i + 1) & 7];
}
function shorten(i) {
  const b = [...whole];
  b.length = i & 3;
  return b.length + ":" + String(b[2]) + ":" + String(b[0]);
}
function sum(list) {
  let total = 0;
  for (let k = 0; k < list.length; k++) total += list[k];
  return total;
}
function handOn(i) {
  const b = [...whole];
  return sum(b) + b[i & 7];
}
function carried(n) {
  let b = [...whole];
  let total = 0;
  for (let k = 0; k < n; k++) {
    total += b[k & 7];
    b = [...b];
    if (k === 5) b[3] = 0.5;
    if (k === 9) b[4] = "s";
  }
  return total;
}
function readFractions(i) {
  const b = [...fractions];
  return (b[i & 3] | 0) + (b[2] | 0) + b[7];
}
function readWords(i) {
  const b = [...words];
  return b[i & 3] + b[2];
}
function sourceChangesBehindTheCopy(i) {
  const source = [];
  for (let k = 0; k < 4; k++) source.push(k + i);
  const b = [...source];
  source[1] = 0.75;
  source.push("late");
  return b[1] + ":" + b.length + ":" + source[1] + ":" + source.length;
}

class Holder {
  kept = [...whole];
  static shared = [...whole];
  read(i) {
    const b = [...whole];
    return b[i & 7] + this.kept[i & 7] + Holder.shared[(i + 1) & 7];
  }
  change(i) {
    const b = [...this.kept];
    b[i & 7] = i + 0.5;
    return b[i & 7] + b[(i + 1) & 7] + this.kept[i & 7];
  }
}
const holder = new Holder();
function inAMethod(i) {
  return holder.read(i) + ":" + holder.change(i);
}
const atTheTopLevel = [...whole];
console.log(atTheTopLevel[3] + atTheTopLevel[7], atTheTopLevel.length, String(atTheTopLevel[8]));
atTheTopLevel[3] = 1.5;
console.log(atTheTopLevel[3] + atTheTopLevel[7], whole[3]);
const ofConstants = [...[1, 2, 3]];
console.log(ofConstants[0] + ofConstants[2], ofConstants.length);

const all = [inAMethod, read, readPastTheEnd, storeFraction, storeWord, storeNaN, storeFarBehindTheEnd, grow, takeAway, shorten, handOn, carried, readFractions, readWords, sourceChangesBehindTheCopy];
for (const f of all) {
  const seen = [];
  for (let i = 0; i < 12; i++) seen.push(f(i));
  console.log(f.name, seen.join(" "));
}
console.log(whole.join(), fractions.join(), words.join());
