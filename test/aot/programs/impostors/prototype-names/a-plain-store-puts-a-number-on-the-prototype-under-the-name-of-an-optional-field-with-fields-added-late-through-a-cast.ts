// A plain store puts a number on the prototype of a class under the name of an optional field,
// after 3000 rounds of reads that found the slot empty and of first stores that filled it.
// In this twin the class declares only what its constructor stores: the other fields are added late, through a cast to an interface.
interface LinksShape {
  flags: number;
  resolved?: number;
  target?: object;
}
class Links {
  declare flags: number;
  constructor(flags: number) {
    this.flags = flags;
  }
}
function read(links: LinksShape) {
  return links.resolved;
}
function write(links: LinksShape, value: number) {
  links.resolved = value;
}
function resolve(links: LinksShape, value: number) {
  return links.resolved ?? (links.resolved = value);
}
function describe(links: LinksShape) {
  return [read(links), "resolved" in links, Object.hasOwn(links, "resolved"), Object.keys(links).join()].map(String).join(" ");
}
function readStoreRead(links: LinksShape, holder: any) {
  const before = links.resolved;
  holder.resolved = 7;
  return [before, links.resolved];
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const links = new Links(i) as LinksShape;
  if (read(links) === undefined) sum++;
  if (i & 1) write(links, i);
  sum += resolve(links, 2);
}
console.log("warm", sum);

const empty = new Links(1) as LinksShape;
const alsoEmpty = new Links(2) as LinksShape;
const filled = new Links(3) as LinksShape;
write(filled, 30);
console.log("before:", describe(empty), "|", describe(filled));
console.log("around the store:", readStoreRead(empty, Links.prototype).join());
const fresh = new Links(4) as LinksShape;
console.log("inherited:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log("resolve finds it:", resolve(alsoEmpty, 5), describe(alsoEmpty));
write(empty, 10);
write(fresh, 40);
console.log("stored over it:", describe(empty), "|", describe(fresh));
delete empty.resolved;
console.log("own one deleted:", describe(empty));
(Links.prototype as any).resolved = undefined;
console.log("undefined on the prototype:", describe(empty), "|", describe((new Links(5) as LinksShape)), "|", resolve((new Links(6) as LinksShape), 60));
delete (Links.prototype as any).resolved;
console.log("gone again:", describe(empty), "|", describe(filled), "|", describe(fresh), "|", describe((new Links(7) as LinksShape)));
sum = 0;
for (let i = 0; i < 3000; i++) {
  const links = new Links(i) as LinksShape;
  if (read(links) === undefined) sum++;
  if (i & 1) write(links, i);
  sum += resolve(links, 2);
}
console.log("afterwards", sum);
