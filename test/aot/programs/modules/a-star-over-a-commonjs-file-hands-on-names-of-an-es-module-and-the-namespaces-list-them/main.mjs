// A CommonJS file as tsc emits it, with a default of its own, hands on names of an ES module behind getters. The namespace objects of the file and of the modules that export all of it list every name.
import * as barrel from "./barrel.mjs";
import { first } from "./outer-barrel.mjs";
console.log(first, Object.keys(barrel), typeof barrel.Unread, barrel.default);
barrel.bump();
console.log(barrel.count);
const emitted = await import("./emitted.cjs");
console.log(Object.keys(emitted), typeof emitted.Unread, emitted.default, emitted.count);
const outer = await import("./outer-barrel.mjs");
console.log(Object.keys(outer), outer.Unread === emitted.Unread);
