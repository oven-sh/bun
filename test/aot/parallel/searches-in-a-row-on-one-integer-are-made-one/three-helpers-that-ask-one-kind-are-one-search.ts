// STATISTIC: SwitchesTakenIntoSwitchInFront >= 1
function isLoud(kind: number): boolean {
  return kind === 253 || kind === 252 || kind === 260 || kind === 247 || kind === 245 || kind === 243 || kind === 250 || kind === 251 || kind === 249 || kind === 246 || kind === 257 || kind === 354;
}
function isNamed(kind: number): boolean {
  switch (kind) {
    case 263:
    case 283:
    case 264:
    case 265:
    case 266:
    case 273:
    case 272:
      return true;
    default:
      return false;
  }
}
function isFar(kind: number): boolean {
  switch (kind) {
    case 300:
    case 301:
    case 302:
    case 330:
    case 331:
      return true;
    default:
      return false;
  }
}
class Piece {
  kind: number;
  constructor(kind: number) {
    this.kind = kind;
  }
}
function isOneOfThem(piece: Piece): boolean {
  const kind = piece.kind;
  return isLoud(kind) || isNamed(kind) || isFar(kind) || kind === 242;
}
let said = "";
for (let kind = 236; kind < 360; kind++) said += isOneOfThem(new Piece(kind)) ? "x" : ".";
const others = [-1, 0, 243.5, NaN, -0, 2 ** 31 + 243, 2 ** 32 + 243, -243, 1e300, Infinity, 354, 355];
for (const other of others) said += isOneOfThem(new Piece(other)) ? "X" : "-";
console.log(said);
