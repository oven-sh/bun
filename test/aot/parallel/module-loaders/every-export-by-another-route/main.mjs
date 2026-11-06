// A module is imported for one name and loaded again by a loader that reaches its call through a field: every export is there, and a store made that way is seen by the import.
import { createRequire } from "node:module";
import { read, state } from "./state.mjs";
const load = { held: createRequire }.held(import.meta.url);
const all = load("./state.mjs");
console.log(Object.keys(all).sort().join(), all.unused());
all.set("changed");
console.log(state, read(), all.state);
