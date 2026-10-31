// require.resolve() of a name that the "exports" of its package turns away throws, though a file lies at that path.
// Alone: what the resolver of an executable finds goes by the files that the executable holds
const { createRequire } = require("node:module");

function attempt(what, resolve) {
  try {
    console.log(what + ":", resolve().replaceAll("\\", "/").split("node_modules/").pop());
  } catch (error) {
    console.log(what + ":", "throws", error.name, error.code, error.message.split("\n")[0].split(" from ")[0]);
  }
}

attempt("the package", () => require.resolve("hides-by-null"));
attempt("its package.json", () => require.resolve("hides-by-null/package.json"));
attempt("a file that no key names", () => require.resolve("hides-by-null/hidden.js"));
attempt("a key that is null", () => require.resolve("hides-by-null/hidden"));
attempt("the exported file by its path", () => require.resolve("hides-by-null/a.js"));
attempt("a file that is not there", () => require.resolve("hides-by-null/absent.js"));
attempt("beside exports that are a text", () => require.resolve("exports-one-file/b.js"));
attempt("through a pattern", () => require.resolve("exports-a-pattern/lib/x"));
attempt("what a pattern leads to", () => require.resolve("exports-a-pattern/src/x.js"));
attempt("in a scope", () => require.resolve("@scope/hides/hidden.js"));
attempt("no condition holds", () => require.resolve("exports-for-browsers"));
attempt("a target outside the package", () => require.resolve("exports-outside-itself/x"));
attempt("a template", () => require.resolve(`hides-by-null/hidden.js`));
attempt("a require that was made", () => createRequire(__filename).resolve("hides-by-null/hidden.js"));
const sameRequire = require;
attempt("require under another name", () => sameRequire.resolve("hides-by-null/hidden.js"));
const isOther = process.argv.length > 99;
attempt("one of two names", () => require.resolve(isOther ? "hides-by-null" : "hides-by-null/hidden.js"));
attempt("the other of the two", () => require.resolve(isOther ? "hides-by-null/hidden.js" : "hides-by-null"));
attempt("and it loads as little", () => require("hides-by-null/hidden.js").which);
module.exports = attempt;
require("./asks-import-meta.mjs");
