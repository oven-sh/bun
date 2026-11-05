// Object.defineProperty makes a name of a function read-only unless the descriptor says otherwise, and a store under that name throws a TypeError in strict code wherever it stands: in the function that defines the name, in one that is handed the function, or in one that gets it back. Each module makes a function that nobody reads.
// STATISTIC: InitializersDeferred >= 1
const modules = {
  "the store stands in a function that is handed the function": () => import("./handed-on.mjs"),
  "the store stands two calls deep": () => import("./handed-on-twice.mjs"),
  "the definition stands in a function that hands the function back": () => import("./handed-back.mjs"),
  "an arrow function, a name that can be defined again": () => import("./arrow.mjs"),
  "both stand in one function": () => import("./one-function.mjs"),
  "the name is writable": () => import("./writable.mjs"),
  "the store is under another name": () => import("./another-name.mjs"),
  "the name of the function": () => import("./name-of-the-function.mjs"),
  "the function is given a name and nothing is stored": () => import("./only-named.mjs"),
};
for (const name in modules) {
  try {
    await modules[name]();
    console.log(name + ": ran to its end");
  } catch (error) {
    console.log(name + ": " + error?.constructor?.name);
  }
}
