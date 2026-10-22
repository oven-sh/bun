// Calls what a load by a computed name answered, under member names that are computed too. The load holds what the modules of the library export, it does not call it: a function of the library is compiled if the program calls it somewhere. What the program also calls by its name, native functions and the functions of the program's own files answer as in plain Bun.
// A function of the library that nothing in the program calls, or whose module nothing names, answers as in plain Bun or throws one error that names what was left out. Both print the same line here.
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();
const crypto = require("crypto");
console.log(crypto.createHash("sha1").update("a").digest("hex").length);
exports.double = function double(value) {
  return value * 2;
};

const loaded = {};
function call(module, member, ...operands) {
  const name = decoded(module);
  loaded[name] ??= require(name);
  return loaded[name][decoded(member)](...operands);
}
function attempt(label, action) {
  try {
    console.log(label + ": " + action());
  } catch (error) {
    console.log(label + ": throws " + error.name + ": " + error.message);
  }
}
function saysWhatWasLeftOut(error, names) {
  const message = String(error.message);
  const isAboutTheExecutable = /^(ERR_)?MODULE_NOT_FOUND$/.test(error.code) || message.includes("bun compile differs from bun run here");
  return isAboutTheExecutable && names.some(name => message.includes(name));
}
function attemptWhatMayBeLeftOut(label, names, action) {
  attempt(label, () => {
    try {
      return action() ? "answers or says what was left out" : "a wrong answer";
    } catch (error) {
      if (!saysWhatWasLeftOut(error, names)) throw error;
      return "answers or says what was left out";
    }
  });
}

attempt("a function that the program also calls by its name", () => call("crypto", "createHash", "sha1").update("a").digest("hex"));
attempt("a native function", () => call("crypto", "randomBytes", 4).length);
attempt("a native function of a native module that nothing names", () => call("node:buffer", "isUtf8", Buffer.from("a")));
attempt("a function of the program that nothing calls by its name", () => call("./call-what-was-loaded.cjs", "double", 21));
attemptWhatMayBeLeftOut("a function of the library that nothing calls by its name", ["createHmac"], () => typeof call("crypto", "createHmac", "sha1", "key") === "object");
attemptWhatMayBeLeftOut("a function of a module that nothing names", ["node:os", "hostname"], () => typeof call("node:os", "hostname") === "string");
