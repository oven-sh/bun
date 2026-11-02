// Every load of the CommonJS file reads names alone. An import() and a made require() under a name that the build
// cannot know still find every name, and `default` is the object of the file.
import { createRequire } from "node:module";
import { used } from "./lib/values.cjs";
const path = process.env.VALUES_PATH ?? "./lib/values.cjs";
const { unused } = await import(path);
console.log(used(2), unused(2));
console.log(typeof (await import(path)).other, typeof (await import(path)).default);
const { default: all } = await import(path);
console.log(Object.keys(all).join());
const { other } = createRequire(import.meta.url)(path);
console.log(other(2));
