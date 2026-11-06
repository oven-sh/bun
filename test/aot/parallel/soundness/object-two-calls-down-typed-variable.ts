// The typed twin of an-object-handed-two-calls-down-is-changed-through-a-variable-that-holds-it.js.
type Plain = { x: number };
function outer(): number {
  const o: Plain = { x: 0 };
  middle(o);
  return o.x;
}
function middle(o: Plain): void { inner(o); }
function inner(q: Plain): void {
  let p: Plain = { x: 5 };
  function change(): void { p.x = 1; }
  p = q;
  change();
}
console.log(outer());

class Point { x = 0; y = 0; }
function outerOfClass(start: number): number {
  const o = new Point();
  o.x = start;
  middleOfClass(o);
  return o.x + o.y;
}
function middleOfClass(o: Point): void { innerOfClass(o); }
function innerOfClass(q: Point): void {
  let p: Point | null = null;
  const change = (): void => { if (p) { p.x += 1; p.y = 7; } };
  p = q;
  change();
}
const seen: number[] = [];
for (let i = 0; i < 5; i++) seen.push(outerOfClass(i * 10));
console.log(seen.join());
