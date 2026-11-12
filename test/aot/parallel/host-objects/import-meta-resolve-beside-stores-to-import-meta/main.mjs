// A program that defines `path` on its import.meta, deletes `resolve` from it and stores another function there gets from import.meta.resolve what plain Bun gives.
const { resolve } = import.meta;
const name = ["./main", "mjs"].join(".");
const own = import.meta.url;
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };

Object.defineProperty(import.meta, "path", { value: "/nowhere/else.mjs" });
console.log("own path", import.meta.path, attempt(() => import.meta.resolve(name) === own), attempt(() => resolve(name) === own), attempt(() => import.meta.resolveSync(name) === import.meta.filename));

console.log("delete", delete import.meta.resolve, "resolve" in import.meta, typeof import.meta.resolve, attempt(() => resolve(name) === own), Object.keys(import.meta));
import.meta.resolve = () => "replaced";
console.log("replaced", import.meta.resolve(name), attempt(() => resolve(name) === own), Object.keys(import.meta));
delete import.meta.resolve;
console.log("deleted again", attempt(() => import.meta.resolve(name) === own), import.meta.resolve === resolve, Object.keys(import.meta));
