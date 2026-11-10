// STATISTIC: SpeculationsEmitted >= 0
class Piece {
  kind: number;
  label: Piece | undefined;
  constructor(kind: number, label?: Piece) {
    this.kind = kind;
    this.label = label;
  }
}
let meddles = 0;
function isQuery(piece: Piece): boolean {
  return piece.kind === 187;
}
function isMaker(piece: Piece): boolean {
  if (piece.kind === 400 && meddles === 1) delete (piece as any).kind;
  if (piece.kind === 400 && meddles === 2) Object.defineProperty(piece, "kind", { get: () => 173, configurable: true });
  if (piece.kind === 400 && meddles === 3) piece.kind = 173;
  if (piece.kind === 400 && meddles === 4) Object.setPrototypeOf(piece, { extra: 1 });
  if (piece.kind === 400 && meddles === 5) (piece as any).kind = "173";
  return piece.kind === 263;
}
function isPutOff(piece: Piece, last: Piece | undefined): boolean {
  if (piece.kind !== 220 && piece.kind !== 219) {
    return isQuery(piece) || ((isMaker(piece) || piece.kind === 173) && (!last || last !== piece.label));
  }
  return !(last && last === piece.label);
}
const held: Array<(piece: Piece, last: Piece | undefined) => boolean> = [isPutOff];
const asked = held[Number(process.argv[2] ?? 0)];
const said: string[] = [];
for (meddles = 0; meddles < 6; meddles++) {
  const piece = new Piece(400);
  said.push(meddles + ":" + asked(piece, undefined) + ":" + String((piece as any).kind));
}
console.log(said.join(" "));
