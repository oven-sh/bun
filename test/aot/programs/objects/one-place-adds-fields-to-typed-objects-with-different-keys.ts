// As one-place-adds-fields-to-objects-with-different-keys.js, typed and in strict code: a store that may not happen throws.
interface Base { kind: number; pos: number; late?: number | string; first?: number; second?: number | string; third?: number; earlier?: number }
class Made implements Base {
  kind: number; pos = 0;
  declare late?: number | string; declare first?: number; declare second?: number | string; declare third?: number; declare earlier?: number;
  constructor(kind: number) { this.kind = kind; }
}
class Below extends Made { own = "own"; }
function addOne(node: Base, value: number) { node.late = value; return node; }
function addRun(node: Base, a: number, b: number, c: number) { node.first = a; node.second = b; node.third = c; return node; }
function show(object: object) { return Object.keys(object).join(",") + " | " + JSON.stringify(object) + " | " + Object.entries(object).length; }
function attempt(work: () => object) { try { return show(work()); } catch (error) { return (error as Error).name; } }
const makers: (() => Base)[] = [
  () => new Made(1),
  () => { const made = new Made(2); made.earlier = 1; return made; },
  () => { const made = new Made(3); made.second = "already"; return made; },
  () => new Below(4),
  () => ({ kind: 5, pos: 1 }),
  () => ({ pos: 1, kind: 6 }),
  () => ({ kind: 7, pos: 1, third: 9 }),
  () => Object.freeze(new Made(8)),
  () => Object.preventExtensions(new Made(9)),
  () => { const made = new Made(10); made.late = 1; delete made.late; made.earlier = 2; return made; },
];
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < makers.length; i++) {
    for (let again = 0; again < 3; again++) {
      console.log(round, i, again, attempt(() => addOne(makers[i]!(), round)), "/", attempt(() => addRun(makers[i]!(), 1, 2, 3)), "/", attempt(() => addRun(addOne(makers[i]!(), round), 1, 2, 3)), "/", attempt(() => addOne(addRun(makers[i]!(), 1, 2, 3), round)));
    }
  }
}
