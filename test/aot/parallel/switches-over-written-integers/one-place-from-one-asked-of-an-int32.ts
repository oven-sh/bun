// A switch over written integers, one place from one, asked of an int32: every integer round its cases, the same moved by 2 ** 32, the halves between them, and what is no integer.
// STATISTIC: SwitchWindowsToldByBits >= 1
function weigh(x: number): number { switch (x) { case 1: case 5: case 9: case 12: case 17: case 23: case 31: case 40: return 1; default: return 0; } }
function ask(x: number) { return weigh(x | 0); }
const near: number[] = [-69, -68, -67, -66, -65, -64, -63, -62, -61, -60, -59, -58, -57, -56, -55, -54, -53, -52, -51, -50, -49, -48, -47, -46, -45, -44, -43, -42, -41, -40, -39, -38, -37, -36, -35, -34, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23, -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const odd: any[] = [-0, 0.5, -0.5, NaN, Infinity, -Infinity, 1e19, -1e19, 4294967296, -4294967296, 9007199254740991, -9007199254740991, 2147483648, -2147483649];
const strange: any[] = [undefined, null, true, false, "5", "", 5n, {}, [], [5], { valueOf() { return 5; } }];
let sum = 0, seen = 0; const tally = [0, 0, 0, 0, 0, 0, 0, 0, 0];
function note(given: number, place: number) { tally[given + 1]++; sum = (Math.imul(sum, 31) + given + place) | 0; seen++; }
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < near.length; i++) { note(ask(near[i]), i); note(ask((near[i] + 4294967296)), i); note(ask((near[i] - 4294967296)), i); note(ask((near[i] + 0.5)), i); }
  for (let i = 0; i < odd.length; i++) note(ask(odd[i]), i);
}
console.log(sum, seen, tally.join(" "));
