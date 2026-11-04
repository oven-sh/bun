// x is laid on a member of a union that does not list it: map alias, text; the union is read as the member; the read of all; tag of the lister.
interface A { kind: string; x: number }
interface B { kind: string; y: string }
interface C { kind: string; z: boolean }
type Any = A | B | C;
function makeA(n: number): A { return { kind: "a", x: n }; }
function makeB(n: number): B { return { kind: "b", y: "t" + n }; }
function makeC(n: number): C { return { kind: "c", z: n > 0 }; }
function show(w: unknown): string { return typeof w === "function" ? "function " + w.name : typeof w === "object" && w ? JSON.stringify(w) : String(w); }
function read(value: Any): unknown { return (value as A).x; }
const byName = new Map<string, unknown>();
function run(n: number) {
  const o = makeB(n);
  const all: Any[] = [makeA(n), o, makeC(n)];
  const v: unknown = "laid";
  (o as any).kind = "a";
  byName.set("o", o); (byName.get("o") as any).x = v;
  for (const each of all) console.log(show(read(each)));
}
try { run(1); run(2); } catch (error) { console.log((error as Error).constructor.name); }
