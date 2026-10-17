// A switch over integers whose cases lead to one place is range tests and bit tests, a window of 64 values each. Thirty cases over 174 values
// need three windows. The tree above the windows parts the cases between two windows, not through one.
// SIZE< holdsNames 160
// SIZE< classOf 260
declare const console: { log(...values: unknown[]): void };
declare const globalThis: { kept?: unknown };
function holdsNames(kind: number): boolean {
  switch (kind) {
    case 219: case 241: case 179: case 269: case 299: case 175: case 194: case 176: case 185: case 180:
    case 248: case 249: case 250: case 262: case 218: case 184: case 177: case 181: case 338: case 340:
    case 317: case 323: case 346: case 200: case 174: case 173: case 267: case 178: case 307: case 265:
      return true;
    default:
      return false;
  }
}
function classOf(kind: number): number {
  switch (kind) {
    case 10: case 11: case 12: case 40: case 41: case 70: case 71: case 72: case 73:
      return 1;
    case 100: case 101: case 130: case 131: case 132: case 160: case 161: case 190: case 191:
      return 2;
    case 13: case 14: case 102: case 103: case 192: case 193: case 220: case 221: case 250:
      return 3;
    default:
      return 0;
  }
}
globalThis.kept = [holdsNames, classOf];
const [first, second] = globalThis.kept as [(kind: number) => boolean, (kind: number) => number];
let listed = "";
let classes = "";
for (let kind = 0; kind < 400; kind++) {
  if (first(kind)) listed += kind + " ";
  const found = second(kind);
  if (found) classes += kind + ":" + found + " ";
}
console.log(listed);
console.log(classes);
console.log(first(-173), first(173.5), first(NaN), first(2 ** 32 + 173), first(-0), second(10.5), second(-10), second(2 ** 31 + 10));
