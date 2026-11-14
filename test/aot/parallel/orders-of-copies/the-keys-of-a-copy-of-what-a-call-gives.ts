// `{ ...base(k), name }`: the order of the keys is what the language says, whichever order the plan holds ready: what the call gives first, then the names written, a name written again stays in its first place.
function base(kind: number) { return { kind, parent: undefined as any, pos: 0 }; }
function other(kind: number) { return { pos: 1, kind, extra: "e" }; }
function either(k: number): any { return k & 1 ? base(k) : other(k); }
function nothing(): any { return undefined; }
const makers: ((i: number) => any)[] = [
  i => ({ ...base(i), name: "n", resolved: undefined }),
  i => ({ name: "n", ...base(i) }),
  i => ({ name: "n", ...base(i), resolved: i }),
  i => ({ ...base(i), kind: "again", name: "n" }),
  i => ({ kind: "first", ...(base(i) as { parent: any; pos: number }), name: "n" }),
  i => ({ ...base(i), ...other(i), name: "n" }),
  i => ({ ...other(i), ...base(i), name: "n" }),
  i => ({ ...either(i), name: "n" }),
  i => ({ ...nothing(), name: "n", pos: i }),
  i => ({ ...base(i), [i & 1 ? "name" : "pos"]: "computed", last: 1 }),
  i => ({ ...base(i), name() { return i; } }),
  i => ({ ...base(i), get name() { return i; }, last: 1 }),
  i => ({ ...base(i), 1: "index", name: "n", 0: "zero" }),
];
const lines: string[] = [];
for (let i = 0; i < 4; i++) for (let m = 0; m < makers.length; m++) { const o = makers[m](i); lines.push(m + " " + Object.keys(o).join() + " " + JSON.stringify(o)); }
console.log(lines.join("\n"));
