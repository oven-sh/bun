// Plain objects of one shape can lie in cells of different sizes. A conversion in place writes no more than the object's own cell holds, whichever size the first converted object had.
type Link = { n: number; next: Link | null; previous: Link | null };

function typedLink(n: number): Link {
  return { n, next: null, previous: null };
}
function weigh(link: Link): number {
  return link.n + (link.next ? link.next.n : 1) + (link.previous ? link.previous.n : 1);
}
function grow(n: number): any {
  const link: any = { n };
  link.next = null;
  link.previous = null;
  return link;
}

let sum = weigh(typedLink(1));
const links: any[] = [];
for (let i = 0; i < 3000; i++) links.push(grow(i));
for (let i = 0; i < links.length; i++) sum += weigh(links[i]);
for (let i = 0; i < links.length; i++) sum += links[i].n + Object.keys(links[i]).length;
console.log(sum);
