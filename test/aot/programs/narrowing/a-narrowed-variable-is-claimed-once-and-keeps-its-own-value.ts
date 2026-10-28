// A region in which the checker has narrowed a variable has one conversion, also where the narrow type extends the type of the variable. What the guard or the assertion claims may be false:
// then nothing throws, every read gives what plain JavaScript gives, and behind the region, in a closure and in a handler the variable is what it was.
// Where the first reads stand in two arms, each arm has its test, and the read behind their join has none: every way to it has passed one.
// IRT= 1 nested = TypeTest
// IRT= 2 eachArm = TypeTest
interface Wide { kind: number }
interface Narrow extends Wide { kind: 1; a: number; b: number }
function claims(x: Wide): x is Narrow { return x.kind !== 0; }
function guarded(x: Wide) { const sum = claims(x) ? x.a + x.b + x.a : -1; return () => sum + ":" + x.kind; }
function asserted(x: Wide) { return (x as Narrow).a + "," + (x as Narrow).b + "," + (x as Narrow).a; }
function nested(x: Wide, first: boolean) { if (!claims(x)) return "none"; const a = x.a; if (first) return a + "+" + x.b; return a + "-" + x.b; }
function eachArm(x: Wide, first: boolean) { if (!claims(x)) return "none"; let t; if (first) t = x.a; else t = x.b; return t + "/" + x.a; }
function otherValue(x: Wide, y: Wide) { if (!claims(x)) return "none"; const a = x.a; x = y; return claims(x) ? a + "&" + x.a : a + "&none"; }
function throws(value: unknown): never { throw value; }
function underHandler(x: Wide) { try { throws((x as Narrow).a); } catch (thrown) { return thrown + "!" + (x as Narrow).b; } }
function inLoop(x: Wide, turns: number) { if (!claims(x)) return -1; let t = 0; for (let i = 0; i < turns; i++) t += x.a; return t + x.b; }

const real: Narrow = { kind: 1, a: 2, b: 3 };
const none: Wide = { kind: 0 };
const liar: Wide = { kind: 5 };
const other = { kind: 7, a: "text", extra: true } as unknown as Wide;
for (const x of [real, none, liar, other]) {
  console.log(guarded(x)(), asserted(x), nested(x, true), nested(x, false), eachArm(x, true), eachArm(x, false));
  console.log(otherValue(x, real), otherValue(x, liar), otherValue(real, x), underHandler(x), inLoop(x, 3));
}
let sum = 0;
for (let i = 0; i < 4000; i++) sum += inLoop(i & 7 ? real : liar, 2) || 0;
console.log(sum);
