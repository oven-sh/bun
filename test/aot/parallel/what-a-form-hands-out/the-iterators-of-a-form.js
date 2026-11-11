// entries, keys and values make an iterator of a class of its own below Iterator.prototype; Symbol.iterator holds the function under `entries`.
const form = new FormData();
form.append("a", "1");
form.append("b", new Blob(["x"]));
console.log(`${form[Symbol.iterator] === form.entries} ${form.entries() === form.entries()}`);
const prototype = Object.getPrototypeOf(form.entries());
console.log(
  `${Reflect.ownKeys(prototype).map(String).join(" ")} ${Object.getPrototypeOf(prototype) === Iterator.prototype} ${prototype[Symbol.toStringTag]}`,
);
console.log(
  `${Object.getPrototypeOf(form.keys()) === prototype} ${Object.getPrototypeOf(form.values()) === prototype}`,
);
const entries = form.entries();
const first = entries.next();
console.log(
  `${Reflect.ownKeys(first).join(" ")} ${Array.isArray(first.value)} ${first.value.length} ${first.value.join("=")} ${first.done}`,
);
form.append("c", "3");
console.log([...entries].map(([name, value]) => `${name}:${typeof value}`).join(" "));
const last = entries.next();
console.log(
  `${last.value} ${last.done} ${[...form.keys()].join(" ")} ${form
    .values()
    .map(value => typeof value)
    .toArray()
    .join(" ")}`,
);
for (const receiver of [undefined, {}, form, new Headers().entries()]) {
  try {
    prototype.next.call(receiver);
  } catch (error) {
    console.log(`${error.name} ${error.code}`);
  }
}
