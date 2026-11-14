// STATISTIC: SpeculationsEmitted >= 0
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
  return kind === 263 || kind === 175 || kind === 177;
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
const said: string[] = [];
function counts(answers: number[]) {
  let reads = 0;
  return {
    get kind() {
      said.push("kind " + reads);
      return answers[reads++ % answers.length];
    },
    get label() {
      said.push("label");
      return undefined;
    },
  };
}
const others: any[] = [
  counts([1]),
  counts([1, 1, 187]),
  counts([1, 1, 1, 263]),
  counts([1, 1, 1, 1, 173]),
  counts([220]),
  counts([1, 219]),
  { kind: 187 },
  { kind: 173, label: 4, more: 1 },
  { kind: "187" },
  Object.create(new Piece(187)),
  new Proxy(new Piece(263), { get: (target, key) => (said.push("trap " + String(key)), Reflect.get(target, key)) }),
  7,
  "text",
  new Piece(173),
];
for (const other of others) said.push(String(asked(other, undefined)), String(asked(other, others[0])));
for (const nothing of [null, undefined]) {
  try {
    asked(nothing, undefined);
  } catch (error) {
    said.push((error as Error).constructor.name);
  }
}
console.log(said.join(" "));
