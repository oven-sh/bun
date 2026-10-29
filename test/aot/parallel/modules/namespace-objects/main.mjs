import * as self from "./main.mjs";
import * as values from "./values.mjs";
import * as reexports from "./reexports.mjs";
import * as stars from "./stars.mjs";
import * as first from "./first.cjs";
import * as both from "./both.mjs";
import * as thenable from "./thenable.mjs";
import { onlyFirst, onlySecond, own } from "./stars.mjs";

const spaces = { self, values, reexports, stars, first, both, thenable };
function attempt(what, run) {
  try {
    console.log(what + ":", run());
  } catch (error) {
    console.log(what + ":", "throws", error.name + ":", error.message);
  }
}

attempt("read in the dead zone", () => spaces.self.late);
attempt("keys in the dead zone", () => Object.keys(spaces.self).join());
attempt("`in` in the dead zone", () => "late" in spaces.self);
export const late = "late";
attempt("read after the dead zone", () => spaces.self.late);

for (const [name, space] of Object.entries(spaces)) {
  console.log(name, JSON.stringify(Object.keys(space)), JSON.stringify(Reflect.ownKeys(space).map(String)));
  console.log(name, space[Symbol.toStringTag], Object.prototype.toString.call(space), JSON.stringify(Object.getOwnPropertyDescriptor(space, Symbol.toStringTag)));
  console.log(name, Object.isExtensible(space), Object.isSealed(space), Object.isFrozen(space), Object.getPrototypeOf(space) === null, space.__esModule);
}
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(spaces.values, "apple")), JSON.stringify(Object.getOwnPropertyDescriptor(spaces.stars, "onlyFirst")), Object.getOwnPropertyDescriptor(spaces.values, "absent"));

console.log(spaces.reexports.values === spaces.values, reexports.values === values, spaces.reexports.self === spaces.reexports, spaces.reexports.self.self.own, typeof Object.getOwnPropertyDescriptor(spaces.reexports, "values").value);

console.log(spaces.values.apple, spaces.reexports.values.apple);
spaces.values.setApple(7);
console.log(spaces.values.apple, spaces.reexports.values.apple, values.apple);

console.log(onlyFirst, onlySecond, own, spaces.stars.own, spaces.stars.clash, "clash" in spaces.stars, "default" in spaces.stars, spaces.stars[7], 7 in spaces.stars);
console.log(typeof spaces.first.default, spaces.first.default.default, spaces.first.clash, spaces.first.own);
console.log(spaces.both.onlyLeft, spaces.both.onlyRight, spaces.both.shared, "shared" in spaces.both);

console.log(typeof spaces.thenable.then, await import("./thenable.mjs"), await import("./thenable.mjs"), spaces.thenable.calls);

console.log((await import("./values.mjs")) === values, (await import("./stars.mjs")) === stars, (await import("./first.cjs")) === first);
for (const file of ["values.mjs", "reexports.mjs", "stars.mjs", "first.cjs", "both.mjs"]) console.log(file, (await import("./" + file)) === spaces[file.slice(0, file.indexOf("."))]);

for (const [name, key] of [
  ["values", "apple"],
  ["stars", "onlyFirst"],
  ["first", "clash"],
]) {
  const space = spaces[name];
  const before = space[key];
  attempt(name + " store", () => (space[key] = "stored"));
  attempt(name + " store to a new name", () => (space.added = "stored"));
  attempt(name + " delete", () => delete space[key]);
  attempt(name + " delete of an absent name", () => delete space.absent);
  attempt(name + " delete of the tag", () => delete space[Symbol.toStringTag]);
  attempt(name + " defineProperty", () => Object.defineProperty(space, key, { value: "defined" }) === space);
  attempt(name + " defineProperty with the same value", () => Object.defineProperty(space, key, { value: before }) === space);
  attempt(name + " defineProperty of a new name", () => Object.defineProperty(space, "added", { value: "defined" }) === space);
  attempt(name + " Reflect", () =>
    [
      Reflect.set(space, key, "stored"),
      Reflect.deleteProperty(space, key),
      Reflect.defineProperty(space, key, { value: "defined" }),
      Reflect.defineProperty(space, key, { get() {} }),
      Reflect.defineProperty(space, key, { value: before, writable: true, enumerable: true, configurable: false }),
    ].join(),
  );
  attempt(name + " prototype", () => [Reflect.setPrototypeOf(space, {}), Reflect.setPrototypeOf(space, Object.getPrototypeOf(space)), Reflect.preventExtensions(space)].join());
  attempt(name + " freeze", () => Object.freeze(space) === space);
  console.log(name, space[key] === before, "added" in space, Object.keys(space).length);
}

import("./main.mjs").then(imported => console.log("import() of this module:", imported === self));
