// A class merged with an interface of its name declares no field itself, and two interfaces below fix the tag: the shape of a syntax tree. The constructor stores the tag behind the allocation.
// Every way of listing the keys of such an object names the tag, in front of the field that is added later.
interface Base {
  kind: 1 | 2;
}
interface A extends Base {
  kind: 1;
  a: number;
}
interface B extends Base {
  kind: 2;
  b: number;
}
interface N extends Base {}
class N {
  constructor(kind: 1 | 2) {
    this.kind = kind;
  }
}
const x = new N(1) as unknown as A;
x.a = 5;
const y = new N(2) as unknown as B;
y.b = 6;
const said: string[] = [];
said.push("keys " + Object.keys(x).join());
said.push("entries " + Object.entries(x).join("|"));
said.push("values " + Object.values(x).join());
said.push("spread " + Object.keys({ ...x }).join());
let names = "";
for (const name in x) names += name + " ";
said.push("for-in " + names);
said.push("stringify " + JSON.stringify(y));
said.push("assign " + Object.keys(Object.assign({}, y)).join());
said.push("names " + Object.getOwnPropertyNames(x).join());
said.push("ownKeys " + Reflect.ownKeys(x).join());
said.push("in " + ("kind" in x) + " hasOwn " + Object.hasOwn(x, "kind") + " read " + x.kind + y.kind);
console.log(said.join("\n"));
