// follows a reference from an object to the next
class Link {
  constructor(
    public value: number,
    public weight: number,
    public next: Link | null,
  ) {}
}
const operations = 100;
let first: Link | null = null;
for (let i = 0; i < operations; i++) first = new Link(i, i * 0.5, first);
let total = 0;

kernel: {
  let sum = 0;
  for (let link = first; link !== null; link = link.next) sum += link.value;
  total += sum;
}

console.log(total);
