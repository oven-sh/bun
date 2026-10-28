// A CommonJS file as tsc emits it, with a default of its own, hands on names of an ES module behind getters. Imports through `export *` take some of them, and nothing reads the others.
import { first, bump } from "./barrel.mjs";
import { first as again } from "./outer-barrel.mjs";
bump();
console.log(first, again);
