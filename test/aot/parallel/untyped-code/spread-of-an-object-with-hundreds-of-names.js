// An object with hundreds of names keeps a table of its own. A spread copies the table and the values at once: it looks no name up and plans nothing for a table that no other object has.
// COUNT: counter:FieldMovePlansMade <= 40
// COUNT: counter:AssignmentPlansMade <= 40
function filled(count, into) {
  for (let i = 0; i < count; i++) into["id" + i] = i;
  return into;
}
function digest(object) {
  let sum = 0;
  let names = 0;
  let last = "";
  for (const name of Reflect.ownKeys(object)) {
    names++;
    last = String(name);
    const value = object[name];
    sum = (sum * 31 + (typeof value === "number" ? value : String(value).length)) % 1000003;
  }
  return `${names} ${last} ${sum}`;
}

// One name replaced a turn, as a store of entries by id does it.
let state = filled(700, {});
const names = Object.keys(state);
for (let turn = 0; turn < 3000; turn++) state = { ...state, [names[(turn * 7) % names.length]]: turn };
console.log("replaced", digest(state));

// The copy and its source go their own ways.
const source = filled(300, {});
const copy = { ...source };
copy.id5 = "changed";
copy.added = 1;
delete copy.id7;
source.id9 = "changed in the source";
source.late = 2;
delete source.id11;
console.log("source", digest(source), source.id5, source.id7, "added" in source, "id11" in source);
console.log("copy", digest(copy), copy.id9, copy.id11, "late" in copy, "id7" in copy);
console.log("again", digest({ ...copy }), digest({ ...source }));

// Fields of a literal in front of the names, and names behind a member.
const literal = filled(300, { first: 1, second: "two" });
console.log("literal", digest({ ...literal }), Object.keys({ ...literal }).slice(0, 3).join());
console.log("behind", digest({ zero: 0, ...literal }), Object.keys({ zero: 0, ...literal }).slice(0, 3).join());
console.log("in front", digest({ ...literal, id3: "over", tail: 1 }), Object.keys({ ...literal, tail: 1 }).at(-1));

// Symbols stay behind the strings, each kind in its order.
const mark = Symbol("mark");
const other = Symbol("other");
const marked = filled(100, {});
marked[mark] = 1;
filled(200, marked);
marked[other] = 2;
marked.end = 3;
console.log("symbols", digest({ ...marked }), Reflect.ownKeys({ ...marked }).slice(-3).map(String).join());

// What a copy of the table would get wrong.
const hidden = filled(300, {});
Object.defineProperty(hidden, "secret", { value: 1, enumerable: false });
console.log("hidden", digest({ ...hidden }), "secret" in { ...hidden });
let asked = 0;
const computed = filled(300, {});
Object.defineProperty(computed, "now", { get() { return ++asked; }, enumerable: true, configurable: true });
const taken = { ...computed };
console.log("getter", digest(taken), asked, Object.getOwnPropertyDescriptor(taken, "now").value);
const fixed = filled(300, {});
Object.defineProperty(fixed, "id4", { value: "fixed", writable: false, enumerable: true, configurable: false });
const loose = { ...fixed };
loose.id4 = "written";
console.log("read-only", loose.id4, delete loose.id4, digest(loose));
const frozen = { ...Object.freeze(filled(300, {})) };
frozen.more = 1;
frozen.id0 = "thawed";
console.log("frozen", Object.isFrozen(frozen), Object.isExtensible(frozen), digest(frozen));
const sealed = { ...Object.preventExtensions(filled(300, {})) };
sealed.more = 1;
console.log("closed", Object.isExtensible(sealed), digest(sealed));
const bare = { ...filled(300, Object.create(null)) };
console.log("bare", Object.getPrototypeOf(bare) === Object.prototype, typeof bare.toString, digest(bare));
const below = { ...filled(300, Object.create({ inherited: 1 })) };
console.log("below", Object.getPrototypeOf(below) === Object.prototype, below.inherited, digest(below));
const parent = filled(300, {});
const child = Object.create(parent);
console.log("parent", child.id3, digest({ ...parent }), digest({ ...child }));
const named = filled(300, {});
Object.defineProperty(named, "__proto__", { value: 5, enumerable: true, writable: true, configurable: true });
const renamed = { ...named };
console.log("__proto__", Object.getPrototypeOf(renamed) === Object.prototype, Object.getOwnPropertyDescriptor(renamed, "__proto__").value, digest(renamed));
const indexed = filled(300, {});
indexed[3] = "three";
indexed[1] = "one";
console.log("indexed", digest({ ...indexed }), Object.keys({ ...indexed }).slice(0, 3).join());
const thinned = filled(300, {});
for (let i = 0; i < 300; i += 2) delete thinned["id" + i];
thinned.back = 1;
console.log("thinned", digest({ ...thinned }), digest({ ...{ ...thinned } }));

// Other ways to copy all of it.
console.log("assign", digest(Object.assign({}, source)), digest(Object.assign({ front: 1 }, source)));
const { id1, id2, ...rest } = source;
console.log("rest", id1, id2, digest(rest));
