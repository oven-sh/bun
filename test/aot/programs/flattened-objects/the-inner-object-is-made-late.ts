// An inner object that somebody holds now and then is born in the outer object and made when it is first wanted. What was stored before, between and after has to be seen through every name.
interface Inner { b: number; s: string; o: { v: number } | null; e?: number }
interface Outer { a: Inner; n: number }
const kept: Inner[] = [];
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
function make(i: number): Outer { return { a: { b: i, s: "s" + i, o: i % 2 ? { v: i } : null }, n: i }; }
function keep(x: Outer) { kept.push(x.a); }
function replace(x: Outer, i: number) { x.a = { b: i, s: "r" + i, o: null }; }
function total(x: Outer) { return x.a.b + x.a.s.length + (x.a.o ? x.a.o.v : 0); }

{ const x = make(1); x.a.b = 10; keep(x); x.a.b += 1; kept[0].b += 1; say("stored before and after", x.a.b, kept[0].b, kept[0] === x.a, total(x)); }
{ const x = make(2); const c = x.a; keep(x); c.b = 20; say("a name from before", x.a.b, c === x.a, c === kept[1]); }
{ const x = make(3); const c = x.a; const before = c.b; replace(x, 30); say("replaced behind a name", before, c.b, c.s, x.a.b, x.a.s, c === x.a); }
{ const x = make(4); keep(x); replace(x, 40); x.a.b += 1; say("made, then replaced by a fresh one", kept[2].b, x.a.b, kept[2] === x.a); keep(x); say("made again", kept[3].b, kept[3] === x.a, kept[3] === kept[2]); }
{ const x = make(5); x.a.b = 0.5; say("a fraction", x.a.b, total(x)); keep(x); say("a fraction", kept[4].b); x.a.b = 2 ** 40; say("a large number", x.a.b, kept[4].b); }
{ const x = make(6); x.a.b = 1.25; x.a.b *= 2; const y = { ...x }; say("a fraction through a copy", y.a.b, y.a === x.a); }
{ const x = make(7); say("optional", x.a.e, "e" in x.a, Object.keys(x.a).join()); x.a.e = 7; say("optional", x.a.e, "e" in x.a, Object.keys(x.a).join()); }
{ const x = make(8); Object.freeze(x); x.a.b = 80; x.a.s = "still stored"; say("outer frozen", x.a.b, x.a.s); keep(x); say("outer frozen", kept[5].b, Object.isFrozen(kept[5])); }
{ const x = make(9); let message = ""; try { (x as any).a(); } catch (error) { message = (error as Error).constructor.name; } say("called", message, x.a.b); }
{ const x = make(11); const o = x.a.o!; Bun.gc(true); keep(x); Bun.gc(true); say("references", o === x.a.o, x.a.o!.v, x.a.s, kept[6].o === o); x.a.o = null; Bun.gc(true); say("references", kept[6].o, o.v); }
{ const local = make(12); const inner = local.a; say("outer stays in the function", inner.b + local.n); kept.push(inner); }
say("outer stayed in the function", kept[7].b, kept[7].s);
{ const x = make(13); let seen = -1; try { const c = x.a; if (x.n === 13) throw c; seen = c.b; } catch (thrown) { seen = (thrown as Inner).b; say("thrown", thrown === x.a); } say("thrown", seen); }
{ let x = make(14); let sum = 0; for (let i = 0; i < 5; i++) { const c = x.a; sum += c.b; if (i === 2) keep(x); c.b += 1; if (i === 3) x = make(100); } say("in a loop", sum, x.a.b, kept[8].b); }
{ const pick = (flag: boolean, x: Outer, y: Outer) => (flag ? x.a : y.a); const x = make(15), y = make(16); pick(true, x, y).b = 150; pick(false, x, y).b = 160; say("either of two", x.a.b, y.a.b, pick(true, x, y) === x.a); }
async function later(x: Outer) { const c = x.a; await null; c.b += 1; await null; return c.b + x.a.b; }
function* steps(x: Outer) { const c = x.a; yield c.b; replace(x, 170); yield c.b; yield x.a.b; }
say("generator", [...steps(make(17))].join());

interface WithMethod { a: { b: number; twice(): number; arrow: () => number }; n: number }
function makeWithMethod(i: number): WithMethod { return { a: { b: i, twice() { return this.b * 2; }, arrow: () => i }, n: i }; }
{ const x = makeWithMethod(18); x.a.b += 1; say("methods", x.a.twice(), x.a.arrow(), x.a.twice === x.a.twice, typeof x.a.twice); const { twice } = x.a; say("methods", twice.call({ b: 5 })); }

class Vector { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } plus(other: Vector) { return new Vector(this.x + other.x, this.y + other.y); } }
class Body { position: Vector; velocity: Vector; constructor(i: number) { this.position = new Vector(i, i); this.velocity = new Vector(1, 2); } step() { this.position = this.position.plus(this.velocity); } }
{ const bodies: Body[] = []; for (let i = 0; i < 1000; i++) bodies.push(new Body(i)); const first = bodies[0].position; for (let round = 0; round < 3; round++) for (const body of bodies) body.step(); Bun.gc(true); let sum = 0; for (const body of bodies) sum += body.position.x + body.position.y + body.velocity.y; say("bodies", sum, first.x, first === bodies[0].position, bodies[999].position instanceof Vector); }

{ const many: Outer[] = []; for (let i = 0; i < 20000; i++) many.push(make(i)); for (let i = 0; i < many.length; i += 7) keep(many[i]); Bun.gc(true); let sum = 0; for (let i = 0; i < many.length; i++) { many[i].a.b += 1; sum += total(many[i]); } let held = 0; for (const inner of kept) held += inner.b; say("many", sum, held, kept.length); }
later(make(19)).then(value => { say("async", value); console.log(lines.join("\n")); });
