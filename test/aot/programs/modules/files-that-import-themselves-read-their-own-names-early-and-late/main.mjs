// A file that imports itself begins once. Whoever imports it runs behind its end, and what it reads of itself throws until the store has run, by whatever way the name is read.
import * as self from "./main.mjs";
import hooks, { readLate } from "./hooks.mjs";
import { a, readB } from "./a.mjs";
const attempt = (name, read) => {
  try {
    console.log(name, read());
  } catch (error) {
    console.log(name, error.name);
  }
};
attempt("own name ahead of its store", () => self.own);
export const own = "own";
attempt("own name behind its store", () => self.own);
attempt("members of the namespace of a file that imports itself", () => hooks.other + hooks["late"]);
attempt("a function of that file", readLate);
attempt("a cycle of two files that import themselves too", () => a + readB());
attempt("keys", () => Object.keys(hooks).join() + "|" + Object.keys(self).join());
