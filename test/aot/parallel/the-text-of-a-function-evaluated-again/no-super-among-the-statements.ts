// Without a super(..) among the statements of the constructor the stores stand at its start, where `this` is not there yet.
class Root { kind = "root"; }
class Leaf extends Root {
  // @ts-expect-error a super call must be a root-level statement
  constructor(public flag: boolean) { if (flag) { super(); } else { super(); } }
}
const Again = (0, eval)("(function (Root) { return (" + String(Leaf) + "); })")(Root);
for (const Made of [Leaf, Again]) {
  try { console.log(JSON.stringify(new Made(true))); } catch (error) { console.log((error as Error).name); }
}
