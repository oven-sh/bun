// Flags: --aot-verify-each-pass
// A switch on strings over a spread, in a file with types.
// Code that the build does not see calls the function, and has been handed text objects and lists: so what is walked is a value nobody knows, which by its proven type
// may be any of them. The loop has an arm for each kind of collection, also for those that nobody expects, and what is left goes on to the next arm.
const print = (s: string) => console.log(s);
const unseen = (f: Function): any => new Function("f", "return (...a) => f(...a)")(f);
const kinds: [string, (s: any) => any][] = [
  ["same", s => s],
  ["object", s => new String(s)],
  ["array", s => [s]],
];
const values: any[] = ["lit", "other", 3, 7, null, "x"];
function walk(list: any): number {
  let n = 0;
  for (const s of [...list]) {
    switch (s) {
      case "lit":
        n += 1;
        break;
      case "other":
        n += 20;
        break;
      default:
        n += 4000;
    }
  }
  return n;
}
function kindOf(it: any): string {
  return typeof it;
}
for (const [kind, make] of kinds) print("kindOf " + kind + ": " + values.map(it => unseen(kindOf)(make(it))).join());
for (const [kind, make] of kinds) print("walk " + kind + ": " + unseen(walk)(values.map(make)));
for (const it of ["lit", new String("other"), 7, null, { lit: 1 }]) {
  try {
    print("walk: " + unseen(walk)(it));
  } catch (error) {
    print("walk: " + (error as Error).constructor.name);
  }
}
