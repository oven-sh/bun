// RUN: lower
// CHECK-LABEL: function {{*}}name="store"
// CHECK: [[links]] = PropGet {{*}} key="links"
// CHECK-NEXT: [[said]] = Convert [[links]] declared={type={{*}} flags=[IsExpected]}
// CHECK-NEXT: PropSet [[said]], {{*}} key="target"
// RUN(READ): lower
// READ-LABEL: function {{*}}name="read"
// READ: [[links]] = PropGet {{*}} key="links"
// READ-NEXT: [[said]] = Convert [[links]] declared={type={{*}} flags=[IsExpected]}
// READ-NEXT: PropGet [[said]] key="target"
// RUN(INHERITED): lower
// INHERITED-LABEL: function {{*}}name="inherited"
// INHERITED: [[first]] = PropGet {{*}} key="first"
// INHERITED-NEXT: PropGet [[first]] key="target"
// RUN(ALONE): lower
// ALONE-LABEL: function {{*}}name="ofInterfaceThatExtendsNothing"
// ALONE: [[first]] = PropGet {{*}} key="first"
// ALONE-NEXT: PropGet [[first]] key="target"
// RUN(HANDED): lower
// HANDED-LABEL: function {{*}}name="handedOn"
// HANDED: [[links]] = PropGet {{*}} key="links"
// HANDED-NEXT: Return [[links]]
// RUN(TEXT): lower
// TEXT-LABEL: function {{*}}name="ofText"
// TEXT: [[label]] = PropGet {{*}} key="label"
// TEXT-NEXT: PropGet [[label]] key="length"

// The slot of a field holds what the type of the field says, so a member that is read is said to be nothing. One case is left: an interface adds a member to what it
// extends, and the objects are made under the name of what it extends, by a constructor that writes `any` for the field or nothing at all. Then only the receiver's written
// type says what the member holds. Where such a member is read only to read, store or call a member of it, that is said of the value, as it is of the result of a call that
// is read like an object: it is expected, not established. A member that comes from what is extended, a member of an interface that extends nothing, a member that is handed
// on and one whose type names no layout are said to be nothing.
interface Links {
  target?: Holder;
}

interface Holder {
  first: Links;
}

interface HolderWithLinks extends Holder {
  links: Links;
  label: string;
}

export function store(holder: HolderWithLinks, target: Holder): void {
  holder.links.target = target;
}

export function read(holder: HolderWithLinks): Holder | undefined {
  return holder.links.target;
}

export function inherited(holder: HolderWithLinks): Holder | undefined {
  return holder.first.target;
}

export function ofInterfaceThatExtendsNothing(holder: Holder): Holder | undefined {
  return holder.first.target;
}

export function handedOn(holder: HolderWithLinks): unknown {
  return holder.links;
}

export function ofText(holder: HolderWithLinks): number {
  return holder.label.length;
}
