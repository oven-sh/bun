// Objects of a class expression get their fields late, through a cast, as the TypeScript compiler's links do.
// A store under a key that is computed at run time puts an object of that name on the prototype.
interface LinksShape {
  _brand: any;
  checkFlags?: number;
  target?: { id: number };
  type?: { id: number };
}
const Links = class implements LinksShape {
  declare _brand: any;
};
function make(flags: number): LinksShape {
  const links = new Links() as LinksShape;
  links.checkFlags = flags;
  return links;
}
function typeOf(links: LinksShape, fallback: { id: number }) {
  if (!links.type) links.type = fallback;
  return links.type;
}
function peek(links: LinksShape) {
  return links.type;
}
function describe(links: LinksShape) {
  return `${peek(links)?.id} ${"type" in links} ${Object.hasOwn(links, "type")} [${Object.keys(links)}]`;
}
function readStoreRead(links: LinksShape, holder: any, key: string, value: { id: number }) {
  const before = links.type;
  holder[key] = value;
  const after = links.type;
  return `${before?.id} ${after?.id}`;
}

const fallback = { id: 1 };
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const links = make(i & 7);
  if (peek(links) === undefined) sum++;
  if (typeOf(links, fallback) === fallback) sum += links.checkFlags!;
  if (typeOf(links, fallback) === fallback) sum++;
}
console.log("warm", sum);

const key = JSON.parse('["ty","pe"]').join("");
const empty = make(1);
const second = make(2);
const filled = make(3);
typeOf(filled, fallback);
console.log("before:", describe(empty), "|", describe(filled));
console.log("around the store:", readStoreRead(empty, Links.prototype, key, { id: 99 }));
const fresh = make(4);
console.log("inherited:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log("typeOf keeps the inherited one:", typeOf(second, fallback).id, describe(second));
empty.type = { id: 5 };
console.log("stored over it:", describe(empty));
delete (Links.prototype as any)[key];
console.log("gone again:", describe(empty), "|", describe(second), "|", describe(fresh), "|", describe(make(5)));
console.log("typeOf fills:", typeOf(second, fallback).id, describe(second));
