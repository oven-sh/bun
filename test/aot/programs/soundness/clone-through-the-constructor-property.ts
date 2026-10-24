class TreeNode {
  children: TreeNode[] = [];
  constructor(public tag: string = "node") {}
  clone(): this { const copy = new (this.constructor as new (tag: string) => this)(this.tag); copy.children = this.children.map(c => c.clone()); return copy; }
  describe(): string { return this.tag + "(" + this.children.map(c => c.describe()).join() + ")"; }
}
class Leaf extends TreeNode {
  weight: number = 1;
  describe(): string { return "leaf:" + this.tag + ":" + this.weight; }
}
const root = new TreeNode("root"); const leaf = new Leaf("l"); leaf.weight = 7; root.children.push(leaf, new TreeNode("n"));
const copy = root.clone();
console.log(copy.describe(), copy.children[0] instanceof Leaf, (copy.children[0] as Leaf).weight, copy !== root);
