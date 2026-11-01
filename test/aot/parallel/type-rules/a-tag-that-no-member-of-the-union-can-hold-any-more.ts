// Flags: --aot-check=verify-each-pass
// A test of a union's tag keeps the members whose field can hold what was read, and every member where none can. The second member's tag is declared a string, and is found to hold "z" alone
// only late: by then `x.tag === "b"` has been typed with that member. Now no member can hold "b", so x is any member again, and is typed so at once.
type A = { tag: "a"; p: number };
type B = { tag: "b"; q: number };
const t: string = process.argv[2] ?? "z";
const all: (A | B)[] = [{ tag: "a", p: 1 }];
if (t === "z") { const o = { tag: t as string, q: 2 }; all.push(o as unknown as B); }
let kept: unknown = null;
function run(x: A | B) {
  if (x.tag === "b") { kept = x; return "b"; }
  return "other";
}
for (const x of all) console.log(run(x), kept === null);
