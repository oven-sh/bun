// Parents and children that refer to each other, removed and moved
class Folder {
  constructor(name, parent = null) {
    this.name = name;
    this.children = [];
    this.parent = null;
    if (parent) parent.add(this);
  }
  add(child) {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
    return this;
  }
  get path() {
    return (this.parent ? this.parent.path + "/" : "") + this.name;
  }
}
function run(name) {
  const root = new Folder("root"), a = new Folder(name, root), b = new Folder(name + 2, a), c = new Folder("c", root);
  c.add(b);
  return [b.path, root.children.map(one => one.name).join("+"), a.children.length, b.parent.parent === root].join();
}
console.log(run("a"));
console.log(run("docs"));
console.log(run(""));
