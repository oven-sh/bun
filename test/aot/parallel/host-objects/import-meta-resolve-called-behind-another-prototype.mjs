// import.meta has its members from an object above it, so another prototype takes them away: a call of one throws a TypeError that a try catches.
const said = [];
const attempt = (name, call) => {
  try {
    said.push(`${name}: ${typeof call()}`);
  } catch (error) {
    said.push(`${name}: ${error.constructor.name}: ${error.message}`);
  }
};
attempt("resolve before", () => import.meta.resolve("./x.mjs"));
attempt("resolveSync before", () => import.meta.resolveSync("node:path"));
attempt("require before", () => import.meta.require("node:path"));
console.log(Object.setPrototypeOf(import.meta, { inherited: 1 }) === import.meta, import.meta.inherited);
attempt("resolve", () => import.meta.resolve("./x.mjs"));
attempt("resolveSync", () => import.meta.resolveSync("node:path"));
attempt("require", () => import.meta.require("node:path"));
console.log(said.join("\n"));
console.log(typeof import.meta.resolve, typeof import.meta.resolveSync, typeof import.meta.require, "resolve" in import.meta);
