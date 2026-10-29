// The typed twin of an-object-handed-two-calls-down-is-changed-through-what-holds-it.js: the stores are stores to fields of known layouts.
type Plain = { x: number };
type Holder = { inner: Plain };
function change(h: Holder): void { h.inner.x = 1; }
function hold(o: Plain): void { const h: Holder = { inner: o }; change(h); }
function via(o: Plain): void { hold(o); }
function first(): number { const o: Plain = { x: 0 }; via(o); return o.x; }
function direct(): number { const o: Plain = { x: 0 }; hold(o); return o.x; }

class Point { x = 0; y = 0; }
class Box { constructor(public held: Point) {} }
function changeBox(b: Box): void { b.held.x += 2; b.held.y = 3; }
function holdInBox(p: Point): void { changeBox(new Box(p)); }
function viaBox(p: Point): void { holdInBox(p); }
function second(): number { const p = new Point(); p.x = 5; viaBox(p); return p.x * 10 + p.y; }

function changeList(list: Plain[]): void { list[0].x = 9; }
function holdInList(o: Plain): void { changeList([o]); }
function viaList(o: Plain): void { holdInList(o); }
function third(): number { const o: Plain = { x: 0 }; viaList(o); return o.x; }

function run(f: () => void): void { f(); }
function holdInClosure(o: Plain): void { run(() => { o.x = 13; }); }
function viaClosure(o: Plain): void { holdInClosure(o); }
function fourth(): number { const o: Plain = { x: 0 }; viaClosure(o); return o.x; }

class Counter {
  count = 0;
  bump(): void { const add = (): void => { this.count += 1; }; add(); add(); }
}
function viaMethod(c: Counter): void { c.bump(); }
function fifth(): number { const c = new Counter(); viaMethod(c); return c.count; }

function changeMap(map: Map<string, Plain>): void { map.get("o")!.x = 19; }
function holdInMap(o: Plain): void { const map = new Map<string, Plain>(); map.set("o", o); changeMap(map); }
function viaMap(o: Plain): void { holdInMap(o); }
function sixth(): number { const o: Plain = { x: 0 }; viaMap(o); return o.x; }

console.log(first(), direct(), second(), third(), fourth(), fifth(), sixth());
let sum = 0;
for (let i = 0; i < 4; i++) sum += first() + direct() + second() + third() + fourth() + fifth() + sixth();
console.log(sum);
