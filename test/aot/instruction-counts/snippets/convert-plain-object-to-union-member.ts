// passes plain objects with a discriminant to a typed function whose parameter is a union of two record types
type Inner = { n: number };
type Circle = { kind: "circle"; inner: Inner; radius: number };
type Square = { kind: "square"; inner: Inner; side: number };
type Figure = Circle | Square;
const operations = 100;
const makeInner = (n: number): Inner => ({ n });
const makeFigure = (i: number, inner: Inner): Figure => (i % 2 ? { kind: "circle", inner, radius: i } : { kind: "square", inner, side: i });
const grow = (i: number, inner: Inner): any => {
  const figure: any = { kind: i % 2 ? "circle" : "square" };
  figure.inner = inner;
  if (i % 2) figure.radius = i;
  else figure.side = i;
  return figure;
};
const read = (figure: Figure) => figure.inner.n + (figure.kind === "circle" ? figure.radius : figure.side);
const inner = makeInner(7);
let total = read(makeFigure(1, inner)) + read(makeFigure(2, inner));
let kept: unknown;

kernel: {
  for (let i = 0; i < operations; i++) {
    const figure = grow(i, inner);
    kept = figure;
    total += read(figure);
  }
}

console.log(total, kept === undefined);
