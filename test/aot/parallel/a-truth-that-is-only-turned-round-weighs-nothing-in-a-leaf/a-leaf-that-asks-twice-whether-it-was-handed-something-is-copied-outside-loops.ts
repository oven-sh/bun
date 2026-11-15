// STATISTIC: CallsInlined >= 12
class Piece {
  kind: number;
  label: Piece | undefined;
  constructor(kind: number, label?: Piece) {
    this.kind = kind;
    this.label = label;
  }
}
function isMakerKind(kind: number): boolean {
  switch (kind) {
    case 263:
    case 175:
    case 177:
    case 178:
    case 179:
    case 219:
    case 220:
      return true;
    default:
      return false;
  }
}
function isMaker(piece: Piece | undefined): boolean {
  return !!piece && isMakerKind(piece.kind);
}
function isPutOff(piece: Piece, last: Piece | undefined): boolean {
  if (piece.kind === 187) return true;
  return (isMaker(piece) || piece.kind === 173) && (!last || last !== piece.label);
}
const label = new Piece(80);
let yes = 0;
for (let kind = 150; kind < 280; kind++) {
  const piece = new Piece(kind, kind & 1 ? label : undefined);
  yes += Number(isPutOff(piece, undefined)) + 2 * Number(isPutOff(piece, label));
}
console.log(yes, isMaker(undefined), isMaker(label), isMaker(new Piece(175)));
