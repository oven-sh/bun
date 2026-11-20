// acts-at-load.test.ts runs this for two modules of Bun, in a process of its own: what the load of the second reads of the first.
//
//   bun reads-of-another-module.fixture.js <first> <second>
//
// A module that is loaded behind a store of the program reads what the store left. So a load may run late only if it reads nothing of
// another module that a program can replace, and the first module has to be loaded for its objects to be there: hence two modules a run.
//
// It prints one line that begins with `mark`, as JSON: the paths that the load of the second read and wrote, as the table of built-ins
// spells them (`node:stream.Transform`, `node:events.prototype.on`).
//
// What it watches: the object that `require(first)` gives, the classes that the object holds with their prototypes, and the plain objects
// that it holds, all one step deep. A function that is read and whose `prototype` a program can assign is taken to be read for that too.
// What it cannot see: a member that is an accessor or cannot be configured, a member under a symbol, `name` and `length` of a function,
// a read by Object.getOwnPropertyDescriptor(), which runs no getter, and a read of the prototype of the function that the first module
// itself is: acts-at-load.test.ts holds `chain` for that of node:events.
const mark = "acts-at-load: ";
const [first, second] = process.argv.slice(2);

const { defineProperty, getOwnPropertyDescriptor, getPrototypeOf, prototype: objectPrototype } = Object;
const { ownKeys } = Reflect;
const notWatched = new Set(["prototype", "constructor", "name", "length", "caller", "arguments"]);

const read = new Set();
const written = new Set();
let isLoading = false;

const isObject = value => (typeof value === "object" && value !== null) || typeof value === "function";
const isPlainObject = value =>
  typeof value === "object" && value !== null && [objectPrototype, null].includes(getPrototypeOf(value));

const holdsPrototypeThatMayBeReplaced = value =>
  typeof value === "function" && getOwnPropertyDescriptor(value, "prototype")?.writable === true;

const watched = new Map();
function watch(holder, path, holdsMore) {
  if (watched.has(holder)) return;
  watched.set(holder, path);
  for (const name of ownKeys(holder)) {
    if (typeof name !== "string" || notWatched.has(name)) continue;
    const descriptor = getOwnPropertyDescriptor(holder, name);
    if (!descriptor.configurable || !("value" in descriptor)) continue;
    const member = `${path}.${name}`;
    let value = descriptor.value;
    if (holdsMore && typeof value === "function" && isObject(value.prototype)) {
      watch(value, member, false);
      watch(value.prototype, `${member}.prototype`, false);
    } else if (holdsMore && isPlainObject(value)) {
      watch(value, member, false);
    }
    defineProperty(holder, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        if (isLoading) {
          read.add(member);
          // `class extends` and inherits() read the prototype of a function, and no getter can be laid over that name of a function.
          if (holdsPrototypeThatMayBeReplaced(value)) read.add(`${member}.prototype`);
        }
        return value;
      },
      set(next) {
        // A store to an object that inherits the name makes a property of that object, as it does without this getter.
        if (this !== holder) {
          defineProperty(this, name, { configurable: true, enumerable: true, writable: true, value: next });
          return;
        }
        if (isLoading) written.add(member);
        value = next;
      },
    });
  }
}

let threw = null;
try {
  const exported = require(first);
  if (isObject(exported)) {
    if (typeof exported === "function" && isObject(exported.prototype))
      watch(exported.prototype, `${first}.prototype`, false);
    watch(exported, first, true);
  }
  isLoading = true;
  require(second);
} catch (error) {
  threw = String(error?.message ?? error).split("\n")[0];
}
isLoading = false;

// `require("node:util").types` is the object of node:util/types, and the table lists its members there.
function pathInItsOwnModule(path) {
  for (const [holder, below] of watched) {
    const name = below.slice(first.length + 1);
    if (!path.startsWith(`${below}.`) || name === "" || name.includes(".")) continue;
    try {
      if (require(`${first}/${name}`) === holder) return `${first}/${name}${path.slice(below.length)}`;
    } catch {}
  }
  return path;
}
const pathsOf = paths => Array.from(paths, pathInItsOwnModule).sort();

// Not console.log: the getters above lie over what the first module holds, and that may be `console`.
const line = `\n${mark}${JSON.stringify({ read: pathsOf(read), written: pathsOf(written), threw })}\n`;
require("node:fs").writeSync(1, line);
process.exit(0);
