// STATISTIC: SpeculationsEmitted <= 10
class Piece {
  kind: number;
  label: Piece | undefined;
  constructor(kind: number, label?: Piece) {
    this.kind = kind;
    this.label = label;
  }
}
function isQuery(piece: Piece): boolean {
  return piece.kind === 187;
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
function isMaker(piece: Piece): boolean {
  return !!piece && isMakerKind(piece.kind);
}
function isPutOff(piece: Piece, last: Piece | undefined): boolean {
  if (piece.kind !== 220 && piece.kind !== 219) {
    return isQuery(piece) || ((isMaker(piece) || piece.kind === 173) && (!last || last !== piece.label));
  }
  return !(last && last === piece.label);
}
const held: Array<(piece: any, last: any) => boolean> = [isPutOff];
const asked = held[Number(process.argv[2] ?? 0)];
const label = new Piece(80);
let yes = 0;
for (let kind = 150; kind < 280; kind++) {
  const piece = new Piece(kind, kind & 1 ? label : undefined);
  yes += Number(asked(piece, undefined)) + 2 * Number(asked(piece, label));
}
for (const text of ['{"kind":187}', '{"kind":263}', '{"kind":173,"label":1}', '{"kind":220}', '{"kind":5}']) yes = yes * 2 + Number(asked(JSON.parse(text), undefined));
console.log(yes);
