// createRequire is given a parent that is put together at run time, and what it returns is given the names of packages that are not installed. Each load throws what the module loader throws for a package it can't find.
import { createRequire } from "node:module";
const parent = [import.meta.url].join("");
const report = load => {
  try {
    console.log(load());
  } catch (error) {
    console.log(error.name, error.code, error.message.split("\n")[0].replace(/ from .*/, ""));
  }
};
report(() => createRequire(parent)("a-package-that-is-not-installed"));
report(() => createRequire(parent)("a-package-that-is-not-installed/lib/index.js"));
report(() => createRequire(parent)("@a-scope/a-package-that-is-not-installed"));
