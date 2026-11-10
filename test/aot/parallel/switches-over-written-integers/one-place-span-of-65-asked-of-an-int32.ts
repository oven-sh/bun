// A switch over written integers, one place span of 65, asked of an int32: every integer round its cases, the same moved by 2 ** 32, the halves between them, and what is no integer.
// STATISTIC: SwitchesAnsweredByByteOfTable >= 1
function weigh(x: number): number { switch (x) { case 80: case 84: case 85: case 90: case 97: case 103: case 144: return 1; default: return 0; } }
function ask(x: number) { return weigh(x | 0); }
const near: number[] = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214];
const odd: any[] = [-0, 0.5, -0.5, NaN, Infinity, -Infinity, 1e19, -1e19, 4294967296, -4294967296, 9007199254740991, -9007199254740991, 2147483648, -2147483649];
const strange: any[] = [undefined, null, true, false, "5", "", 5n, {}, [], [5], { valueOf() { return 5; } }];
let sum = 0, seen = 0; const tally = [0, 0, 0, 0, 0, 0, 0, 0, 0];
function note(given: number, place: number) { tally[given + 1]++; sum = (Math.imul(sum, 31) + given + place) | 0; seen++; }
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < near.length; i++) { note(ask(near[i]), i); note(ask((near[i] + 4294967296)), i); note(ask((near[i] - 4294967296)), i); note(ask((near[i] + 0.5)), i); }
  for (let i = 0; i < odd.length; i++) note(ask(odd[i]), i);
}
console.log(sum, seen, tally.join(" "));
