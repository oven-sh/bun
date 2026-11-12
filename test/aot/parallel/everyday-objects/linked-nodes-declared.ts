// Nodes of a declared class, linked, summed and reversed
class Link {
  next: Link | null = null;
  constructor(public value: number) {}
  static of(...values: number[]): Link | null {
    let first: Link | null = null;
    for (let i = values.length - 1; i >= 0; i--) {
      const link = new Link(values[i]);
      link.next = first;
      first = link;
    }
    return first;
  }
}
function sum(values: number[]): string {
  let total = 0;
  let last: Link | null = null;
  for (let at = Link.of(...values); at !== null; ) {
    total += at.value;
    const next: Link | null = at.next;
    at.next = last;
    last = at;
    at = next;
  }
  return total + " " + last?.value + " " + last?.next?.value;
}
console.log(sum([1, 2, 3]));
console.log(sum([40]));
console.log(sum([5, 6]));
