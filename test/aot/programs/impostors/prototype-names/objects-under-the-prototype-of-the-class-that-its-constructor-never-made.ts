// `instanceof` says yes and the prototype is the right one, but the constructor never ran: Object.create, a literal with __proto__, Object.setPrototypeOf on a literal,
// Reflect.construct(Object, [], C) and a copy by Object.assign. They go through the typed functions side by side with real instances, before and after the prototype gets the name.
const log: string[] = [];
class Links {
  declare id: number;
  declare resolved?: number;
  constructor(id: number) {
    this.id = id;
  }
}
function read(links: Links) {
  return links.resolved;
}
function resolve(links: Links) {
  return (links.resolved ??= links.id * 2);
}
function state(links: Links) {
  return `${read(links)} ${"resolved" in links} ${links instanceof Links} [${Object.keys(links)}]`;
}
const makers: ((id: number) => Links)[] = [
  id => new Links(id),
  id => {
    const links: Links = Object.create(Links.prototype);
    links.id = id;
    return links;
  },
  id => ({ __proto__: Links.prototype, id }) as unknown as Links,
  id => Object.setPrototypeOf({ id }, Links.prototype),
  id => Object.assign(Reflect.construct(Object, [], Links), { id }),
  id => Object.assign(Object.create(Links.prototype), new Links(id)),
];
function row(base: number) {
  return makers.map((make, index) => make(base + index));
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const links = makers[i % makers.length](i & 7);
  sum += read(links) ?? 1;
  if (i & 1) sum += resolve(links);
}
console.log("warm", sum);

const old = row(1);
console.log("before:", old.map(state).join(" | "));
Object.defineProperty(Object.getPrototypeOf(old[3]), "resolved", {
  get() {
    return undefined;
  },
  set(this: Links, value: number) {
    log.push(`${value} for ${this.id}`);
  },
  configurable: true,
});
console.log("accessors:", old.map(state).join(" | "));
console.log("resolve:", old.map(resolve).join(), "|", row(11).map(resolve).join(), "|", log.join(", "));
console.log("after:", old.map(state).join(" | "));
Object.defineProperty(Links.prototype, "resolved", { value: 5, writable: true, configurable: true });
console.log("a value:", old.map(state).join(" | "), "|", row(21).map(resolve).join());
delete (Links.prototype as any).resolved;
console.log("gone again:", old.map(resolve).join(), "|", old.map(state).join(" | "));
