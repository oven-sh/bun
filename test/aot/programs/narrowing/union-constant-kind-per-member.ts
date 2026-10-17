// `s.kind === "circle"` on a union whose members each have a constant `kind`.
// CODE isCircle HAS ldu?rb\s+w\d+, \[x26
// CODE notSquare HAS ldu?rb\s+w\d+, \[x26
// CODE pick HAS ldu?rb\s+w\d+, \[x26
// CODE byswitch HAS ldu?rb\s+w\d+, \[x26
// CODE kindOf LACKS ldu?rb\s+w\d+, \[x26
// CODE sameKind LACKS ldu?rb\s+w\d+, \[x26
// CODE isCircleOrText LACKS ldu?rb\s+w\d+, \[x26
// CODE makeCircle LACKS stu?rb\s+w\d+, \[x26
// CODE makeRound LACKS stu?rb\s+w\d+, \[x26
// CODE restate LACKS stu?rb\s+w\d+, \[x26
// CODE storeGiven HAS stu?rb\s+w\d+, \[x26
// CODE makeGiven HAS stu?rb\s+w\d+, \[x26
interface Circle { kind: "circle"; r: number }
interface Square { kind: "square"; w: number }
interface Triangle { kind: "triangle"; a: number; b: number }
type Shape = Circle | Square | Triangle;
function pick(s: Shape): number { return s.kind === "circle" ? s.r : s.kind === "square" ? s.w : s.a + s.b; }
function byswitch(s: Shape): number { switch (s.kind) { case "circle": return s.r; case "square": return s.w; default: return s.a * s.b; } }
function isCircle(s: Shape): boolean { return s.kind === "circle"; }
function notSquare(s: Shape): boolean { return s.kind !== "square"; }
// The value itself is used, or compared with something that is not a constant: an ordinary read.
function kindOf(s: Shape): string { return s.kind; }
function sameKind(s: Shape, t: Shape): boolean { return s.kind === t.kind; }
// A view with a member that is not pinned: `kind: string`.
interface Text { kind: string; text: string }
function isCircleOrText(s: Circle | Text): boolean { return s.kind === "circle"; }
function makeCircle(r: number): Circle { return { kind: "circle", r }; }
class Round { readonly kind = "round"; constructor(public r: number) {} }
function makeRound(r: number): Round { return new Round(r); }
function isRound(s: Round | Square): boolean { return s.kind === "round"; }
// Storing the constant that it is pinned to again: nothing to guard. Anything else: the byte.
function restate(c: Circle): void { c.kind = "circle"; }
function storeGiven(c: Circle, k: "circle"): void { c.kind = k; }
function makeGiven(k: "circle", r: number): Circle { return { kind: k, r }; }
const asValues: unknown[] = [pick, byswitch, isCircle, notSquare, kindOf, sameKind, isCircleOrText, makeCircle, makeRound, isRound, restate, storeGiven, makeGiven];
const xs: Shape[] = [];
for (let i = 0; i < 12; i++) xs.push(i % 3 === 0 ? { kind: "circle", r: i } : i % 3 === 1 ? { kind: "square", w: i } : { kind: "triangle", a: i, b: 2 });
let sum = 0;
for (const s of xs) sum += pick(s) + byswitch(s) + (isCircle(s) ? 100 : 0) + (notSquare(s) ? 1000 : 0);
console.log(sum, asValues.length);
const c = makeCircle(5), text: Text = { kind: "circle", text: "t" };
console.log(kindOf(c), sameKind(c, xs[0]!), sameKind(c, xs[1]!), isCircleOrText(c), isCircleOrText(text), isCircleOrText({ kind: "other", text: "t" }), isRound(makeRound(1)), isRound(xs[1] as Square));
restate(c); console.log(isCircle(c), pick(c));
storeGiven(c, "circle"); console.log(isCircle(c), pick(c), isCircle(makeGiven("circle", 2)), isCircle(xs[1]!), byswitch(xs[2]!));
