// import.meta.resolve and import.meta.resolveSync taken off import.meta are of that module: whoever calls them, and with whatever receiver, they resolve from it.
import { callIt, helperMeta } from "./lib/helper.mjs";

const { resolve, resolveSync } = import.meta;
const name = "./lib/helper.mjs";
const own = import.meta.resolve("./lib/helper.mjs");
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };

console.log("written", own === helperMeta.url, import.meta.resolve(name) === own);
console.log("taken off", attempt(() => resolve(name) === own), attempt(() => [name].map(resolve)[0] === own), attempt(() => (0, import.meta.resolve)(name) === own));
console.log("call", attempt(() => resolve.call(undefined, name) === own), attempt(() => resolve.call(helperMeta, name) === own), attempt(() => resolve.apply({ path: "/nowhere/else.mjs" }, [name]) === own), attempt(() => Reflect.apply(resolve, "/nowhere/else.mjs", [name]) === own));
console.log("bind", attempt(() => resolve.bind(null)(name) === own), attempt(() => resolve.bind(helperMeta)(name) === own));
console.log("another module", attempt(() => callIt(resolve, name) === own), attempt(() => callIt(helperMeta.resolve, "./helper.mjs") === own), attempt(() => helperMeta.resolve("./helper.mjs") === own), attempt(() => helperMeta.resolve.call(import.meta, "./helper.mjs") === own));
console.log("which", resolve === import.meta.resolve, resolve === Reflect.get(import.meta, "resolve"), resolve === helperMeta.resolve, resolveSync === import.meta.resolveSync, resolveSync === helperMeta.resolveSync);
console.log("what", typeof resolve, resolve.name, resolve.length, typeof resolveSync, resolveSync.name, resolveSync.length, Object.getPrototypeOf(resolve) === Function.prototype, attempt(() => new resolve(name)));
console.log("sync", attempt(() => resolveSync(name) === helperMeta.path), attempt(() => resolveSync.call(undefined, name) === helperMeta.path), attempt(() => callIt(resolveSync, name) === helperMeta.path), attempt(() => helperMeta.resolveSync("./helper.mjs") === helperMeta.path), attempt(() => resolveSync(name, undefined) === helperMeta.path), attempt(() => resolveSync(name, import.meta.path) === helperMeta.path));
console.log("listed", Object.keys(import.meta), Reflect.ownKeys(import.meta), Object.hasOwn(import.meta, "resolve"), Object.hasOwn(import.meta, "resolveSync"));
console.log("described", Object.getOwnPropertyDescriptor(import.meta, "resolve"), Object.getOwnPropertyDescriptor(import.meta, "resolveSync"));
