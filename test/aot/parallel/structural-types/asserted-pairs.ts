// An assertion down to a type with more members, whose members are narrower too. No pair of object types is taken from an assertion.
// Flags: --aot-limit=MaxAssertedTypePairs:0
interface Links {
  kind: string;
  depth: number;
}
interface MappedLinks extends Links {
  mapped: Inner;
}
interface Inner {
  tag: string;
}
interface DeepInner extends Inner {
  deep: number;
}
interface Sym {
  name: string;
  links: Links;
}
interface MappedSym {
  name: string;
  links: MappedLinks;
}
interface DeepLinks extends Links {
  mapped: DeepInner;
}
interface DeepSym {
  name: string;
  links: DeepLinks;
}

function make(name: string, turn: number): Sym {
  const links: any = { kind: "k" + turn, depth: turn };
  if (turn % 3 !== 0) links.mapped = turn % 3 === 1 ? { tag: "t" + turn } : { tag: "d" + turn, deep: turn * 10 };
  return { name, links };
}
function tagOf(sym: Sym): string {
  return (sym as MappedSym).links.mapped ? (sym as MappedSym).links.mapped.tag : "none";
}
function deepOf(sym: Sym): string {
  const mapped = (sym as DeepSym).links.mapped;
  return mapped ? typeof mapped.deep + ":" + mapped.deep : "none";
}
let told = "";
for (let turn = 0; turn < 9; turn++) {
  const sym = make("s" + turn, turn);
  told += sym.name + " " + tagOf(sym) + " " + deepOf(sym) + " " + sym.links.kind + sym.links.depth + "\n";
}
console.log(told);
