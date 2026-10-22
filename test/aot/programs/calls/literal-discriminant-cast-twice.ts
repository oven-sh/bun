// A literal discriminant value goes through two casts before it is stored or compared. A cast is a test and never a conversion: the number 5 cast to boolean throws a TypeError, and 5 cast to the numeric enum passes.
declare const console: any;
function any(x: unknown): any { return x }
enum Kind { A = 1, B = 2, C = 5 }
interface Node { kind: Kind; pos: number }
interface NodeA extends Node { kind: Kind.A; a: number }
interface NodeB extends Node { kind: Kind.B; b: string }
interface NodeC extends Node { kind: Kind.C; x: number; y: number; z: number; text: string; more: number[] }
function NodeConstructor(this: Node, kind: Kind, pos: number) { this.kind = kind; this.pos = pos }
const constructorOfNodes = NodeConstructor as any as new (kind: Kind, pos: number) => Node;
function makeC(kind: Kind): NodeC { const n = new constructorOfNodes(kind, 7) as NodeC; n.x = 1; n.y = 2; n.z = 3; n.text = "text"; n.more = [4]; return n }
function makeA(kind: Kind): NodeA { const n = new constructorOfNodes(kind, 7) as NodeA; n.a = 1; return n }
function nameOf(n: Node): string { switch (n.kind) { case Kind.A: return "A " + (n as NodeA).a; case Kind.B: return "B " + (n as NodeB).b; case Kind.C: return "C " + (n as NodeC).x + (n as NodeC).text; default: return "none" } }
function isC(n: Node): n is NodeC { return n.kind === Kind.C }
function failure(e: unknown): string { return "throws " + (e as Error).constructor.name + ": " + (e as Error).message.split("\n")[0] }
function show(n: Node): string { return [JSON.stringify(n), Object.keys(n).join(), any(n).kind, n.kind, nameOf(n), isC(n), nameOf(any(n) as NodeA)].join(" ") }
const H: unknown[] = ((globalThis as any).H = [5, 1, 2]);
const kept: Node[] = [];
let r = "";
for (let turn = 0; turn < 3; turn++) {
  try { r = show(makeC(any(any(5) as boolean) as Kind)) } catch (e) { r = failure(e) } console.log("C of 5 cast to boolean and then to Kind, written: " + r);
  try { r = show(makeC(any(any(H[0]) as boolean) as Kind)) } catch (e) { r = failure(e) } console.log("C of 5 cast to boolean and then to Kind, hidden:  " + r);
  try { r = show(makeA(any(any(5) as boolean) as Kind)) } catch (e) { r = failure(e) } console.log("A of 5 cast to boolean and then to Kind, written: " + r);
  try { r = show(makeA(any(any(H[0]) as boolean) as Kind)) } catch (e) { r = failure(e) } console.log("A of 5 cast to boolean and then to Kind, hidden:  " + r);
  try { r = show(makeC(any(5) as Kind)) } catch (e) { r = failure(e) } console.log("C of 5, written: " + r);
  try { r = show(makeC(any(H[0]) as Kind)) } catch (e) { r = failure(e) } console.log("C of 5, hidden:  " + r);
  try { r = show(makeC(Kind.C)) } catch (e) { r = failure(e) } console.log("C of 5: " + r);
  for (let i = 0; i < 2000; i++) { try { kept.push(makeC(any(any(5) as boolean) as Kind)) } catch { } kept.push(makeA(Kind.A)) }
}
let sum = 0; for (const n of kept) sum += any(n).kind + n.pos + (any(n).x | 0) + (any(n).a | 0) + (any(n).more ? any(n).more[0] : 0);
console.log(kept.length, sum);
