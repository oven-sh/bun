// RUN: link
// `symbol as MappedSymbol` also says that `symbol.links`, a Links, is a MappedLinks: the code after the cast reads it as one. So the layout of the member's
// type in the source goes below the layout of its type in the target, one level deep.
// CHECK: layout {{*}}name="Links" {{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[mapped]]]
// CHECK: layout [[mapped]] name="MappedLinks"
interface Links {
  target: number;
}
interface MappedLinks {
  target: number;
  mappedType: number;
}
interface SymbolLike {
  flags: number;
  links: Links;
}
interface MappedSymbol {
  flags: number;
  links: MappedLinks;
  isMapped: boolean;
}
export function read(symbol: SymbolLike): number {
  return (symbol as MappedSymbol).links.mappedType;
}
export const answer = read({ flags: 1, links: { target: 2 } });
