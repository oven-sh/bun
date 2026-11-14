class Base {
  static list: any[] = [];
  static tag = "base";
  static create(): any {
    this.list.push(this.tag);
    return new this();
  }
  static get size() {
    return this.list.length;
  }
}
class Mid extends Base {
  static tag = "mid";
}
class Leaf extends Mid {
  static own = 1;
}
const all: any[] = [Base, Mid, Leaf];
function show(): string {
  let text = "";
  for (const C of all) text += C.create().constructor.name + C.tag + C.size + String(C.own) + String(C.late) + " ";
  return text;
}
console.log(show());
(Mid as any).late = "L";
(Leaf as any).tag = "leaf";
delete (Mid as any).tag;
console.log(show());
const key = ["cre", "ate"].join("");
(Leaf as any)[key] = () => ({ constructor: { name: "fake" } });
Object.defineProperty(Mid, "size", { get: () => "many" });
Object.setPrototypeOf(Leaf, Base);
console.log(show(), Object.getOwnPropertyNames(Leaf).join());
