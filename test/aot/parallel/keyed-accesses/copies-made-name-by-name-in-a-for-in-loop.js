// `const copy = {}; for (const key in source) copy[key] = source[key]`, as React's createElement copies props: the names of the source are fields of the copy.
// Text made at run time lists the names, so the build sees nothing that enumerates the copies.
const nothing = String(Date.now()).slice(99);
const describe = new Function(
  "o",
  "return Object.keys(o).join() + ' ' + JSON.stringify(o) + ' ' + Reflect.ownKeys(o).length" + nothing,
);

const source = { type: "div", id: 7, hidden: false, title: null };
function copyOf(from) {
  const copy = {};
  for (const key in from) copy[key] = from[key];
  return copy;
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  source.id = i;
  const copy = copyOf(source);
  sum += copy.id + copy.type.length;
}
console.log(sum, describe(copyOf(source)));

// Some names are left out, one is stored first, one comes later.
function withoutSome(from) {
  const copy = {};
  for (const key in from) if (key !== "hidden" && Object.hasOwn(from, key)) copy[key] = from[key];
  return copy;
}
console.log(describe(withoutSome(source)), withoutSome(source).hidden, "hidden" in withoutSome(source));
function mapped(from) {
  const copy = {};
  for (const key in from) copy[key] = typeof from[key];
  copy.extra = 1;
  return copy;
}
console.log(describe(mapped(source)));

// What happens to a copy afterwards.
const changed = copyOf(source);
delete changed.id;
changed.id = "again";
changed[5] = "index";
changed[Symbol.for("mark")] = true;
console.log(describe(changed), changed.id, changed[5]);
Object.defineProperty(changed, "title", { get: () => "computed", enumerable: false, configurable: true });
console.log(describe(changed), changed.title);
console.log(describe(Object.freeze(copyOf(source))), Object.isFrozen(copyOf(source)));

// The source changes between copies: a name more, a name less, another order, a name from above.
source.added = [1];
console.log(describe(copyOf(source)));
delete source.type;
source.type = "span";
console.log(describe(copyOf(source)));
Object.setPrototypeOf(source, { above: "inherited" });
console.log(describe(copyOf(source)), Object.hasOwn(copyOf(source), "above"));
