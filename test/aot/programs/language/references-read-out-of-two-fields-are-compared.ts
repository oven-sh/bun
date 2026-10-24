// Two references read out of fields are compared with each other, strictly and loosely: objects, undefined and null in every pairing.
class Link {
  id: number;
  parent: Link | undefined;
  next: Link | null;
  other: Link | null | undefined;
  constructor(id: number, parent: Link | undefined, next: Link | null, other: Link | null | undefined) {
    this.id = id | 0;
    this.parent = parent;
    this.next = next;
    this.other = other;
  }
}

const links: Link[] = [];
for (let i = 0; i < 9; ++i) {
  const earlier: Link | undefined = i > 0 ? links[((i * 5) % 7) % i] : undefined;
  const parent: Link | undefined = i % 3 === 0 ? undefined : earlier;
  const next: Link | null = i % 3 === 1 || earlier === undefined ? null : earlier;
  const other: Link | null | undefined = i % 3 === 0 ? undefined : i % 3 === 1 ? null : earlier;
  links.push(new Link(i, parent, next, other));
}

function strictly(a: Link, b: Link): number {
  let bits = 0;
  if (a.parent === b.parent) bits |= 1;
  if (a.next === b.next) bits |= 2;
  if (a.other === b.other) bits |= 4;
  if (a.parent === b.other) bits |= 8;
  if (a.next === b.other) bits |= 16;
  if (a.parent === b.next) bits |= 32;
  if (a.other !== b.other) bits |= 64;
  return bits;
}

function loosely(a: Link, b: Link): number {
  let bits = 0;
  if (a.parent == b.parent) bits |= 1;
  if (a.next == b.next) bits |= 2;
  if (a.other == b.other) bits |= 4;
  if (a.parent == b.other) bits |= 8;
  if (a.next == b.other) bits |= 16;
  if (a.parent == b.next) bits |= 32;
  if (a.other != b.other) bits |= 64;
  return bits;
}

for (const a of links) {
  const strict: number[] = [];
  const loose: number[] = [];
  for (const b of links) {
    strict.push(strictly(a, b));
    loose.push(loosely(a, b));
  }
  console.log(a.id, strict.join(" "), "|", loose.join(" "));
}
