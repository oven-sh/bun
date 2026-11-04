// Made by test/aot/tools/generate-unions-told-by-a-tag.py.
interface A { kind: "a"; a: number }
interface B { kind: "b"; b: number }
interface C { kind: "c"; c: number }
type N = A | B | C;
class Stranger { a = 70; b = 80; kind: unknown; constructor(kind: unknown) { this.kind = kind; } }
let calls = 0;
function show(x: unknown): string { return typeof x + ":" + String(x); }
function later(x: any, tag: unknown): N { x.kind = tag; return x; }
function grown(x: any, tag: unknown): N { x.kind = tag; x.a = 77; return x; }
function isA(x: N): x is A { return x.kind === "a"; }
function tell(x: N): unknown {
  let s: unknown = "none";
  switch (x.kind) {
    case "a": s = show(x.a);
    case "b": return [s, x.kind].join();
    default: return show((x as any).c);
  }
}
function members(): N[] { return [{ kind: "a", a: 1 }, { kind: "b", b: 2 }]; }
function safely(x: N): string {
  try {
    return String(tell(x)) + " " + calls;
  } catch (error: any) {
    return "thrown: " + error.name + " " + calls;
  }
}
for (let turn = 0; turn < 3; turn++) {
  for (const member of members()) console.log(safely(member));
  console.log(safely((new Stranger("a") as any)));
}
