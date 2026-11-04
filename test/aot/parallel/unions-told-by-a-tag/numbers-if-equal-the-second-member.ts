// Made by test/aot/tools/generate-unions-told-by-a-tag.py.
interface A { kind: 1; a: number }
interface B { kind: 2; b: number }
interface C { kind: 3; c: number }
type N = A | B | C;
class Stranger { a = 70; b = 80; kind: unknown; constructor(kind: unknown) { this.kind = kind; } }
let calls = 0;
function show(x: unknown): string { return typeof x + ":" + String(x); }
function later(x: any, tag: unknown): N { x.kind = tag; return x; }
function grown(x: any, tag: unknown): N { x.kind = tag; x.a = 77; return x; }
function isA(x: N): x is A { return x.kind === 1; }
function tell(x: N): unknown {
  if (x.kind === 1) return show(x.a);
  return show((x as any).b);
}
function members(): N[] { return [{ kind: 1, a: 1 }, { kind: 2, b: 2 }]; }
function safely(x: N): string {
  try {
    return String(tell(x)) + " " + calls;
  } catch (error: any) {
    return "thrown: " + error.name + " " + calls;
  }
}
for (let turn = 0; turn < 3; turn++) {
  for (const member of members()) console.log(safely(member));
  console.log(safely({ kind: 2, b: 8 }));
}
