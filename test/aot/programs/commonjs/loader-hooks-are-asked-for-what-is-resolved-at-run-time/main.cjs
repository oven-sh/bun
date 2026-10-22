// The four functions of the loader that a program can replace. Under `bun run` Module._resolveFilename and Module.prototype.require are asked for every require(); Module._load is asked for none.
// In an executable they are asked for what is resolved at run time: a computed name, require.resolve(). A require() with a constant name is the module that the build has found, and asks nobody:
// three lines of `bun run` are not there. The expected output is written down.
const Module = require("node:module");
const glue = (...parts) => parts.join("");
function keep() { return [require("./a.cjs"), require("./b.cjs")]; }
const attempt = (what, f) => { try { console.log(what, "|", String(f())); } catch (e) { console.log(what, "| threw", e.code ?? e.constructor.name, String(e.message).slice(0, 90)); } };
const originalResolve = Module._resolveFilename;
attempt("assign _resolveFilename", () => { Module._resolveFilename = function (request, parent, isMain, options) { console.log("  _resolveFilename asked for", request, typeof parent, isMain); return originalResolve.call(this, request === "alias" ? "./a.cjs" : request, parent, isMain, options); }; return Module._resolveFilename !== originalResolve; });
attempt("a constant require", () => require("./b.cjs").name);
attempt("a computed require", () => require(glue("./b", ".cjs")).name);
attempt("a computed alias", () => require(glue("ali", "as")).name);
attempt("require.resolve of the alias", () => require.resolve(glue("ali", "as")).endsWith("a.cjs"));
attempt("a computed built-in", () => typeof require(glue("node:", "path")).join);
const originalRequire = Module.prototype.require;
attempt("assign prototype.require", () => { Module.prototype.require = function (request) { console.log("  prototype.require asked for", request); return originalRequire.call(this, request === "other" ? "./b.cjs" : request); }; return Module.prototype.require !== originalRequire; });
attempt("a constant require", () => require("./a.cjs").name);
attempt("a computed require", () => require(glue("./a", ".cjs")).name);
attempt("a computed name that the hook turns", () => require(glue("oth", "er")).name);
attempt("module.require computed", () => module.require(glue("oth", "er")).name);
attempt("put both back", () => { Module._resolveFilename = originalResolve; Module.prototype.require = originalRequire; return require(glue("./a", ".cjs")).name; });
const originalLoad = Module._load;
attempt("assign _load", () => { Module._load = function (request, parent, isMain) { console.log("  _load asked for", request); return originalLoad.call(this, request, parent, isMain); }; return Module._load !== originalLoad; });
attempt("a computed require", () => require(glue("./b", ".cjs")).name);
attempt("assign wrap", () => { const w = Module.wrap; Module.wrap = s => w(s); return Module.wrap !== w; });
console.log(typeof keep);
