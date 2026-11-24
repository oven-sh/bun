// References that may be null or undefined, in four bytes each: made, stored, copied from slot to slot and handed on.
class Link {
  name: string | null;
  next: Link | null;
  other: Link | undefined;
  label: string | undefined;
  constructor(name: string | null, next: Link | null, other: Link | undefined, label: string | undefined) {
    this.name = name;
    this.next = next;
    this.other = other;
    this.label = label;
  }
}
function pick(link: Link | null, way: number): Link | null {
  if (link === null) return null;
  return way % 3 === 0 ? link.next : way % 3 === 1 ? link : null;
}
function copy(from: Link, to: Link): void {
  to.next = from.next;
  to.other = from.other;
  to.name = from.name;
  to.label = from.label;
}
function show(link: Link | null | undefined): string {
  if (link === null) return "null";
  if (link === undefined) return "undefined";
  return `${link.name} ${link.label} ${link.next === null ? "null" : link.next!.name} ${link.other === undefined ? "undefined" : link.other!.name}`;
}
const all: Link[] = [];
let last: Link | null = null;
for (let i = 0; i < 24; i++) {
  const before: Link | null = pick(last, i);
  const link: Link = new Link(i % 5 ? "n" + i : null, before, i % 4 ? (before ?? undefined) : undefined, i % 3 ? "l" + i : undefined);
  all.push(link);
  last = i % 7 === 6 ? null : link;
}
for (let i = 0; i + 1 < all.length; i += 3) {
  copy(all[i]!, all[i + 1]!);
  all[i]!.next = pick(all[i + 1]!, i);
  if (i % 2) all[i]!.other = undefined;
  if (i % 4 === 0) all[i]!.label = undefined;
}
for (const link of all) console.log(show(link), "|", show(link.next), "|", show(link.other));
let total = 0;
for (let link: Link | null = all[all.length - 1]!; link !== null && total < 100; link = link.next) total += (link.name ?? "").length + 1;
console.log(total);
