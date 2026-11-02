// The names of the functions of path whichever of their properties is looked at first.
import path from "node:path";
import { inspect } from "node:util";
const show = (label, value) => console.log(label, JSON.stringify(value));
for (const flavor of [path, path.posix, path.win32]) {
  for (const key of ["join", "resolve", "isAbsolute", "parse", "format", "toNamespacedPath"]) {
    const f = flavor[key];
    show(key + " keys first", Reflect.ownKeys(f));
    show(key, [f.name, f.length, String(f).replace(/\s+/g, " "), inspect(f), Bun.inspect(f), typeof f]);
    show(key + " descriptors", Object.getOwnPropertyDescriptors(f));
    show(key + " has", [Object.hasOwn(f, "name"), Object.hasOwn(f, "length"), Object.hasOwn(f, "prototype"), "name" in f]);
  }
}
const late = path.posix.dirname;
show("name first", [late.name, Reflect.ownKeys(late)]);
const length = path.posix.basename;
show("length first", [length.length, Reflect.ownKeys(length), length.name]);
const bound = path.posix.extname.bind(null);
show("bound before a look", [bound.name, bound.length, String(bound).replace(/\s+/g, " "), bound("a.txt")]);
const boundLater = path.posix.dirname.bind(null);
show("bound behind a look", [boundLater.name, boundLater.length, String(boundLater).replace(/\s+/g, " ")]);
const removed = path.posix.relative;
show("delete", [delete removed.name, removed.name, Reflect.ownKeys(removed), Bun.inspect(removed), String(removed).replace(/\s+/g, " ")]);
const defined = path.posix.normalize;
Object.defineProperty(defined, "name", { value: "mine" });
show("define", [defined.name, Reflect.ownKeys(defined), Bun.inspect(defined), inspect(defined)]);
try { (function () { "use strict"; path.win32.join.name = "x"; })(); } catch (e) { show("store", [e.constructor.name, e.message]); }
show("store left", path.win32.join.name);
for (const look of [false, true]) {
  const f = path.win32.resolve;
  if (look) f.name;
  try { f(1); } catch (e) { show("frames " + look, [e.code, e.stack.split("\n")[1].trim().replace(/\(.*\)/, "()")]); }
}
show("assign", Object.keys(Object.assign({}, path.posix.join)));
show("same", [path.join === path.posix.join, path.posix.join.name === path.win32.join.name, path.posix.join === path.win32.join]);
show("frozen", [Object.isFrozen(path.posix.parse), Object.isExtensible(path.posix.parse)]);
Object.freeze(path.posix.parse);
show("frozen now", [Object.isFrozen(path.posix.parse), path.posix.parse.name, Reflect.ownKeys(path.posix.parse)]);
