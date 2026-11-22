// Whether a written constant divides an integer is told without its remainder: for every sign, for even and odd constants, and at both ends of the range.
// STATISTIC: MultiplesTestedWithoutRemainder >= 40
const asked: { divisor: number; ofInt32: (n: number) => boolean; ofUint32: (n: number) => boolean; notOfInt32: (n: number) => boolean }[] = [
  { divisor: 3, ofInt32: n => (n | 0) % 3 === 0, ofUint32: n => (n >>> 0) % 3 === 0, notOfInt32: n => (n | 0) % -3 !== 0 },
  { divisor: 5, ofInt32: n => (n | 0) % 5 === 0, ofUint32: n => (n >>> 0) % 5 === 0, notOfInt32: n => (n | 0) % -5 !== 0 },
  { divisor: 6, ofInt32: n => (n | 0) % 6 === 0, ofUint32: n => (n >>> 0) % 6 === 0, notOfInt32: n => (n | 0) % 6 !== 0 },
  { divisor: 7, ofInt32: n => (n | 0) % 7 === 0, ofUint32: n => (n >>> 0) % 7 === 0, notOfInt32: n => (n | 0) % -7 !== 0 },
  { divisor: 9, ofInt32: n => (n | 0) % 9 === 0, ofUint32: n => (n >>> 0) % 9 === 0, notOfInt32: n => (n | 0) % -9 !== 0 },
  { divisor: 10, ofInt32: n => (n | 0) % 10 === 0, ofUint32: n => (n >>> 0) % 10 === 0, notOfInt32: n => (n | 0) % 10 !== 0 },
  { divisor: 12, ofInt32: n => (n | 0) % 12 === 0, ofUint32: n => (n >>> 0) % 12 === 0, notOfInt32: n => (n | 0) % 12 !== 0 },
  { divisor: 14, ofInt32: n => (n | 0) % 14 === 0, ofUint32: n => (n >>> 0) % 14 === 0, notOfInt32: n => (n | 0) % 14 !== 0 },
  { divisor: 15, ofInt32: n => (n | 0) % 15 === 0, ofUint32: n => (n >>> 0) % 15 === 0, notOfInt32: n => (n | 0) % -15 !== 0 },
  { divisor: 24, ofInt32: n => (n | 0) % 24 === 0, ofUint32: n => (n >>> 0) % 24 === 0, notOfInt32: n => (n | 0) % 24 !== 0 },
  { divisor: 60, ofInt32: n => (n | 0) % 60 === 0, ofUint32: n => (n >>> 0) % 60 === 0, notOfInt32: n => (n | 0) % 60 !== 0 },
  { divisor: 96, ofInt32: n => (n | 0) % 96 === 0, ofUint32: n => (n >>> 0) % 96 === 0, notOfInt32: n => (n | 0) % 96 !== 0 },
  { divisor: 100, ofInt32: n => (n | 0) % 100 === 0, ofUint32: n => (n >>> 0) % 100 === 0, notOfInt32: n => (n | 0) % 100 !== 0 },
  { divisor: 255, ofInt32: n => (n | 0) % 255 === 0, ofUint32: n => (n >>> 0) % 255 === 0, notOfInt32: n => (n | 0) % -255 !== 0 },
  { divisor: 641, ofInt32: n => (n | 0) % 641 === 0, ofUint32: n => (n >>> 0) % 641 === 0, notOfInt32: n => (n | 0) % -641 !== 0 },
  { divisor: 1000, ofInt32: n => (n | 0) % 1000 === 0, ofUint32: n => (n >>> 0) % 1000 === 0, notOfInt32: n => (n | 0) % 1000 !== 0 },
  { divisor: 3072, ofInt32: n => (n | 0) % 3072 === 0, ofUint32: n => (n >>> 0) % 3072 === 0, notOfInt32: n => (n | 0) % 3072 !== 0 },
  { divisor: 65535, ofInt32: n => (n | 0) % 65535 === 0, ofUint32: n => (n >>> 0) % 65535 === 0, notOfInt32: n => (n | 0) % -65535 !== 0 },
  { divisor: 65538, ofInt32: n => (n | 0) % 65538 === 0, ofUint32: n => (n >>> 0) % 65538 === 0, notOfInt32: n => (n | 0) % 65538 !== 0 },
  { divisor: 1000003, ofInt32: n => (n | 0) % 1000003 === 0, ofUint32: n => (n >>> 0) % 1000003 === 0, notOfInt32: n => (n | 0) % -1000003 !== 0 },
  { divisor: 1073741823, ofInt32: n => (n | 0) % 1073741823 === 0, ofUint32: n => (n >>> 0) % 1073741823 === 0, notOfInt32: n => (n | 0) % -1073741823 !== 0 },
  { divisor: 1073741826, ofInt32: n => (n | 0) % 1073741826 === 0, ofUint32: n => (n >>> 0) % 1073741826 === 0, notOfInt32: n => (n | 0) % 1073741826 !== 0 },
  { divisor: 1610612736, ofInt32: n => (n | 0) % 1610612736 === 0, ofUint32: n => (n >>> 0) % 1610612736 === 0, notOfInt32: n => (n | 0) % 1610612736 !== 0 },
  { divisor: 2147483645, ofInt32: n => (n | 0) % 2147483645 === 0, ofUint32: n => (n >>> 0) % 2147483645 === 0, notOfInt32: n => (n | 0) % -2147483645 !== 0 },
  { divisor: 2147483646, ofInt32: n => (n | 0) % 2147483646 === 0, ofUint32: n => (n >>> 0) % 2147483646 === 0, notOfInt32: n => (n | 0) % 2147483646 !== 0 },
  { divisor: 2147483647, ofInt32: n => (n | 0) % 2147483647 === 0, ofUint32: n => (n >>> 0) % 2147483647 === 0, notOfInt32: n => (n | 0) % -2147483647 !== 0 },
];
const numbers: number[] = JSON.parse("[0,1,2,3,5,6,7,30,60,1000,2147483645,2147483646,2147483647,2147483648,4294967294,4294967295,-1,-2,-3,-6,-30,-2147483645,-2147483646,-2147483647,-2147483648]");
let seed: number = JSON.parse("12345");
for (let turn = 0; turn < 400; turn++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  numbers.push(seed, seed >> (turn & 15));
}
let multiples = 0;
let wrong = 0;
for (const { divisor, ofInt32, ofUint32, notOfInt32 } of asked) {
  const near = numbers.concat([divisor, -divisor, divisor + 1, divisor * 2, -divisor * 2, Math.floor(2147483647 / divisor) * divisor, -Math.floor(2147483648 / divisor) * divisor, Math.floor(4294967295 / divisor) * divisor]);
  for (const n of near) {
    const isMultiple = BigInt(n | 0) % BigInt(divisor) === 0n;
    const isUnsignedMultiple = BigInt(n >>> 0) % BigInt(divisor) === 0n;
    multiples += Number(isMultiple) + Number(isUnsignedMultiple);
    if (ofInt32(n) !== isMultiple || notOfInt32(n) === isMultiple || ofUint32(n) !== isUnsignedMultiple) {
      wrong++;
      console.log("wrong", n, divisor, ofInt32(n), notOfInt32(n), ofUint32(n));
    }
  }
}
console.log(multiples, wrong);
// In loops, beside other uses of the remainder, and where the answer is a value.
const limit: number = JSON.parse("1000");
let fizz = "";
let sum = 0;
for (let i = 1; i <= limit; i++) {
  if (i % 15 === 0) fizz += "fb ";
  else if (i % 3 === 0) fizz += "f ";
  else if (i % 5 == 0) fizz += "b ";
  const left = i % 7;
  if (left === 0) sum += 100;
  sum += left + (i % 10 === 0 ? 1 : 2) + Number(i % 12 !== 0);
}
for (let i = -limit; i <= limit; i += 3) if (i % 6 === 0 && !(i % 9 === 0)) sum -= i;
console.log(fizz.length, sum, Object.is((limit - 1003) % 3, -0));
