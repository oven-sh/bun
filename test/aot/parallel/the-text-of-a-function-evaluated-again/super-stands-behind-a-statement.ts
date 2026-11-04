// In a derived class the stores stand behind the first super(..) among the statements of the constructor, wherever that is.
const seen: string[] = [];
class Root { constructor(public base: number) { seen.push("root " + Object.keys(this).join()); } }
class Leaf extends Root {
  size = 1;
  constructor(seed: number, private tag: string = "t") {
    const doubled = seed * 2;
    seen.push("before");
    super(doubled)
    seen.push("behind " + Object.keys(this).join() + " " + this.tag);
  }
  both() { return this.base + this.tag; }
}
const Again = (0, eval)("(function (Root, seen) { return (" + String(Leaf) + "); })")(Root, seen);
for (const Made of [Leaf, Again]) {
  seen.length = 0;
  const leaf = new Made(4);
  console.log(leaf.both(), Object.keys(leaf).join(), seen.join(" | "));
}
