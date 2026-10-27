// A switch over integers whose cases lead to few places is compiled to range tests and bit tests, however many cases it has. The inliner
// measures it as that: a predicate of thirty cases is copied into a loop as one of four is. A switch whose cases each lead somewhere else is as
// large as it was, and stays a call: what each case of `weigh` computes hangs on a second argument, so that no case folds to a constant.
// IRT= 0 walk : boolean = CallDirect
// IRT= 1 walk : (number|i32|int\S*) = CallDirect
declare const console: { log(...values: unknown[]): void };
declare const globalThis: { kept?: unknown };
interface Item { kind: number; parent: Item | undefined; names: number | undefined }
function holdsNames(item: Item): boolean {
  switch (item.kind) {
    case 219: case 241: case 179: case 269: case 299: case 175: case 194: case 176: case 185: case 180:
    case 248: case 249: case 250: case 262: case 218: case 184: case 177: case 181: case 338: case 340:
    case 317: case 323: case 346: case 200: case 174: case 173: case 267: case 178: case 307: case 265:
      return true;
    default:
      return false;
  }
}
function isOneOfFour(item: Item): boolean {
  switch (item.kind) {
    case 219: case 241: case 179: case 269:
      return true;
    default:
      return false;
  }
}
function isWritten(kind: number): boolean {
  return kind === 151 || kind === 153 || kind === 155 || kind === 157 || kind === 159 || kind === 161 || kind === 163 || kind === 165 || kind === 167
    || kind === 169 || kind === 171 || kind === 190 || kind === 192 || kind === 196 || kind === 198 || kind === 202 || kind === 204 || kind === 206;
}
function weigh(kind: number, seed: number): number {
  switch (kind) {
    case 140: return 3 - seed;
    case 142: return 5 + seed;
    case 144: return 7 * seed;
    case 146: return 11 - seed;
    case 148: return 13 ^ seed;
    case 150: return 17 | seed;
    case 152: return 19 & seed;
    case 154: return 23 % seed;
    case 156: return seed << 1;
    case 158: return seed >> 1;
    case 160: return seed * seed;
    case 162: return -seed;
    case 164: return seed + 29;
    case 166: return seed - 31;
    case 168: return seed * 37;
    case 170: return seed ^ 41;
    case 172: return seed | 43;
    case 174: return seed & 47;
    case 176: return seed % 53;
    case 178: return seed << 2;
    case 180: return seed >> 2;
    case 182: return seed >>> 3;
    case 184: return ~seed;
    case 186: return seed * 3 + 1;
    default: return 0;
  }
}
function walk(item: Item | undefined): number {
  let found = 0;
  while (item) {
    if (holdsNames(item) && item.names) found += item.names;
    if (isOneOfFour(item)) found ^= 1;
    if (isWritten(item.kind)) found += 2;
    found = (found + weigh(item.kind, found)) | 0;
    item = item.parent;
  }
  return found;
}
let chain: Item | undefined;
for (let i = 0; i < 400; i++) chain = { kind: 140 + i % 215, parent: chain, names: i & 3 ? i : undefined };
globalThis.kept = [walk, holdsNames, isOneOfFour, isWritten, weigh];
let total = 0;
for (let i = 0; i < 50; i++) total = (total + walk(chain)) | 0;
console.log(total);
for (const kind of [172, 173, 174, 186, 200, 201, 236, 237, 241, 299, 300, 306, 307, 346, 347, -173, 173.5, NaN, 2 ** 32 + 173])
  console.log(kind, holdsNames({ kind, parent: undefined, names: 1 }), isOneOfFour({ kind, parent: undefined, names: 1 }), isWritten(kind), weigh(kind, 7));
