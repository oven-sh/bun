// `const links = new Links() as Shape; links.checkFlags = flags;`: the object is fresh, its slots are known to be empty and its prototype is known to be the class's.
// None of that says what the prototype holds. After 3000 rounds it gets a setter for the field that is stored first and a value for the field that is read first.
interface LinksShape {
  _brand: any;
  checkFlags?: number;
  target?: { id: number };
  nameType?: { id: number };
}
const Links = class implements LinksShape {
  declare _brand: any;
};
const log: string[] = [];
const shared = { id: 1 };
function make(flags: number): LinksShape {
  const links = new Links() as LinksShape;
  links.checkFlags = flags;
  links.target = shared;
  return links;
}
function makeAndLook(flags: number) {
  const links = new Links() as LinksShape;
  const before = links.nameType;
  links.checkFlags = flags;
  const stored = links.checkFlags;
  if (!links.nameType) links.nameType = shared;
  return `${before?.id} ${stored} ${links.nameType.id} [${Object.keys(links)}]`;
}
class Sym {
  declare flags: number;
  declare links?: LinksShape;
  declare parent?: Sym;
  constructor(flags: number) {
    this.flags = flags;
  }
}
function createSymbol(flags: number, checkFlags: number) {
  const symbol = new Sym(flags);
  symbol.links = make(checkFlags);
  return symbol;
}
function state(links: LinksShape) {
  return `${links.checkFlags} ${links.target?.id} ${links.nameType?.id} [${Object.keys(links)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  length += state(make(i & 7)).length + makeAndLook(i & 7).length + Object.keys(createSymbol(i, i)).length;
}
console.log("warm", length);

const holder: any = Object.getPrototypeOf(make(0));
Object.defineProperty(holder, ["check", "Flags"].join(""), {
  get() {
    return -1;
  },
  set(value: number) {
    log.push("checkFlags = " + value);
  },
  configurable: true,
});
holder[["name", "Type"].join("")] = { id: 77 };
console.log("make:", state(make(3)), "|", log.join(", "));
console.log("make and look:", makeAndLook(4), "|", log.join(", "));
Object.defineProperty(Object.getPrototypeOf(new Sym(0)), "links", {
  set(this: Sym, value: LinksShape) {
    log.push("links offered to symbol " + this.flags);
  },
  configurable: true,
});
const symbol = createSymbol(5, 6);
console.log("a symbol:", Object.keys(symbol).join(), symbol.links, "|", log.join(", "));
log.length = 0;
delete holder.checkFlags;
delete holder.nameType;
delete (Sym.prototype as any).links;
console.log("gone again:", state(make(7)), "|", makeAndLook(8), "|", Object.keys(createSymbol(9, 9)).join(), log.length);
