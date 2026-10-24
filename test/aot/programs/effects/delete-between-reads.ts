// delete between two reads: same object, aliased objects, inherited names, a prototype object, a frozen object.
class Point { x?: number; y?: number; constructor(x: number, y: number) { this.x = x; this.y = y } }
class Named { name?: string; constructor(name: string) { this.name = name } }
(Named.prototype as any).name = "from the prototype";

function sameObject(p: Point): string { const before = p.x; delete p.x; return `${before} ${p.x} ${"x" in p} ${p.y}` }
function maybeSameObject(p: Point, q: Point): string { const before = q.x; delete p.x; return `${before} ${q.x} ${"x" in q}` }
function otherName(p: Point): string { const before = p.y; delete p.x; return `${before} ${p.y} ${Object.keys(p).join()}` }
function revealsPrototype(n: Named): string { const before = n.name; delete n.name; return `${before} | ${n.name} | ${Object.hasOwn(n, "name")}` }
function deletesIn(p: Point): boolean { return delete p.x }
function acrossCallee(p: Point, q: Point): string { const before = q.x; const deleted = deletesIn(p); return `${before} ${deleted} ${q.x}` }
function madeHere(n: number): string { const p = new Point(n, n + 1); const before = p.x; delete p.x; p.y = n + 2; return `${before} ${p.x} ${p.y} ${JSON.stringify(p)}` }
function putBack(p: Point, n: number): string { delete p.x; const gone = p.x; p.x = n; return `${gone} ${p.x} ${Object.keys(p).join()}` }
function frozen(p: Point): string { "use strict"; try { delete p.x; return `deleted ${p.x}` } catch (error) { return `${(error as Error).constructor.name} ${p.x}` } }

const base: { shared?: number; own?: number } = { shared: 1 };
const heir: { shared?: number; own?: number } = Object.create(base);
function throughHeir(b: { shared?: number }, h: { shared?: number }): string { const before = h.shared; delete b.shared; return `${before} ${h.shared} ${"shared" in h}` }

for (let round = 0; round < 3; round++) {
  const a = new Point(round, 10), b = new Point(round + 1, 20);
  console.log(sameObject(new Point(round, 5)), "|", maybeSameObject(a, a), "|", maybeSameObject(new Point(1, 2), b), "|", otherName(new Point(3, round)));
  console.log(revealsPrototype(new Named("own " + round)), "|", acrossCallee(b, b), "|", acrossCallee(new Point(7, 8), new Point(round, 9)), "|", madeHere(round), "|", putBack(new Point(1, 2), round));
  console.log(frozen(Object.freeze(new Point(round, 1))), "|", frozen(new Point(round, 1)));
  base.shared = round;
  console.log(throughHeir(base, heir), "|", throughHeir(heir, heir));
}
