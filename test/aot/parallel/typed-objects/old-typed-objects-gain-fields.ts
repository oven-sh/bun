// Typed objects that have grown OLD are given optional fields with values that are no cells: records, members of a union, instances of classes, of subclasses and of a class that every round makes anew, records under a prototype that every round makes anew, and records that were parsed. What such a store gives the object besides the value (another shape, storage) is young, and a collection of the young looks at an old object only if it has been told of it.
// Env: BUN_JSC_verifyGC=1
declare const edenGC: undefined | (() => void);
let kept = 0;
const garbage = typeof edenGC === "function" ? 3000 : 150000;
function churn() { for (let i = 0; i < garbage; i++) kept += JSON.parse('{"a":1,"b":2,"c":3}').c + [i, i + 1, i + 2, i + 3].length; if (typeof edenGC === "function") edenGC(); }
type Opt = { a: number; b?: number; c?: boolean; d?: number | null };
type Circle = { kind: "circle"; r: number; area?: number };
type Square = { kind: "square"; s: number; area?: number };
type Shape = Circle | Square;
interface Node1 { id: number; next?: Node1; weight?: number }
class Base { x = 1; y?: number; z?: boolean; }
class Derived extends Base { w = 2; v?: number; }
function classOf(round: number) { return class Local { p = round; q?: number; r?: boolean; get twice() { return this.p * 2; } }; }
const makeOpt = (i: number): Opt => ({ a: i });
const makeShape = (i: number): Shape => (i & 1 ? { kind: "circle", r: i } : { kind: "square", s: i });
const makeNode = (i: number): Node1 => ({ id: i });
function setB(o: Opt, v: number) { o.b = v; }
function setCD(o: Opt, v: number) { o.c = v > 1; o.d = v & 1 ? null : v; }
function setArea(s: Shape) { s.area = s.kind === "circle" ? s.r * 3 : s.s * s.s; }
function setWeight(n: Node1, v: number) { n.weight = v; }
function setY(o: Base, v: number) { o.y = v; o.z = v > 2; }
function setV(o: Derived, v: number) { o.v = v; o.y = v + 1; }
const rounds = 24, each = 40;
let wrong = 0;
const all: (() => boolean)[] = [];
for (let round = 0; round < rounds; round++) {
  const Local = classOf(round);
  const proto = { from: round };
  const opts: Opt[] = [], opts2: Opt[] = [], shapes: Shape[] = [], nodes: Node1[] = [], bases: Base[] = [], deriveds: Derived[] = [], locals: InstanceType<typeof Local>[] = [], adopted: Opt[] = [], parsed: Opt[] = [];
  for (let i = 0; i < each; i++) {
    opts.push(makeOpt(i)); opts2.push(makeOpt(i)); shapes.push(makeShape(i)); nodes.push(makeNode(i)); bases.push(new Base()); deriveds.push(new Derived()); locals.push(new Local());
    const a = makeOpt(i); Object.setPrototypeOf(a, proto); adopted.push(a);
    parsed.push(JSON.parse('{"a":' + i + "}") as Opt);
  }
  churn();
  for (let turn = 0; turn < 6; turn++) {
    setB(makeOpt(turn), turn); setCD(makeOpt(turn), turn); setArea(makeShape(turn)); setWeight(makeNode(turn), turn); setY(new Base(), turn); setV(new Derived(), turn);
    const l = new Local(); l.q = turn; l.r = true;
    const a = makeOpt(turn); Object.setPrototypeOf(a, proto); setB(a, turn); setCD(a, turn);
    setB(JSON.parse('{"a":' + turn + "}") as Opt, turn);
  }
  for (let i = 0; i < each; i++) {
    setB(opts[i], i); setCD(opts2[i], i); setArea(shapes[i]); setWeight(nodes[i], i); setY(bases[i], i); setV(deriveds[i], i);
    locals[i].q = i; locals[i].r = false;
    setB(adopted[i], i); setCD(adopted[i], i);
    setB(parsed[i], i);
    const o = opts[i], o2 = opts2[i], s = shapes[i], n = nodes[i], b = bases[i], d = deriveds[i], l = locals[i], a = adopted[i], p = parsed[i];
    all.push(() => o.b === i && o.a === i && o2.c === i > 1 && o2.d === (i & 1 ? null : i) && s.area === (s.kind === "circle" ? s.r * 3 : s.s * s.s) && n.weight === i && b.y === i && b.z === i > 2 && d.v === i && d.y === i + 1 && d.w === 2
      && l.q === i && l.r === false && l.twice === round * 2 && a.b === i && (a as any).from === round && a.c === i > 1 && p.b === i && p.a === i && Object.keys(a).join() === "a,b,c,d" && Object.keys(l).join() === "p,q,r");
  }
  churn();
}
for (const right of all) { let ok = false; try { ok = right(); } catch { ok = false; } if (!ok) wrong++; }
console.log(wrong, kept > 0);
