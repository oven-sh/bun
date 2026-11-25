// entries, keys and values make an iterator of a class of its own below Iterator.prototype; Symbol.iterator holds the function under `entries`.
const map = new Bun.CookieMap("a=1; b=2");
console.log(`${map[Symbol.iterator] === map.entries} ${map.entries() === map.entries()}`);
const prototype = Object.getPrototypeOf(map.entries());
console.log(
  `${Reflect.ownKeys(prototype).map(String).join(" ")} ${Object.getPrototypeOf(prototype) === Iterator.prototype} ${prototype[Symbol.toStringTag]}`,
);
console.log(`${[...map].join(" ")} | ${[...map.keys()].join(" ")} | ${[...map.values()].join(" ")}`);
const receiver = { seen: [] };
map.forEach(function (value, name, whole) {
  this.seen.push(`${name}=${value}:${whole === map}`);
}, receiver);
console.log(receiver.seen.join(" "));
for (const other of [undefined, {}, map, new Headers().entries()]) {
  try {
    prototype.next.call(other);
  } catch (error) {
    console.log(`${error.name} ${error.code}`);
  }
}
for (const member of ["get", "has", "set", "delete", "entries", "forEach", "toJSON", "toSetCookieHeaders"]) {
  try {
    Bun.CookieMap.prototype[member].call({}, "a", "b");
  } catch (error) {
    console.log(`${member}: ${error.name}`);
  }
}
try {
  Reflect.get(Bun.CookieMap.prototype, "size", {});
} catch (error) {
  console.log(`size: ${error.name}`);
}
