// `module.exports = { .. }` with shorthand names, functions, arrows, methods and a quoted name.
const lib = require("./lib"), { a, K } = require("./lib");
console.log(lib.a(), lib.K, lib.b, lib.anonymous(), lib.arrow(), lib.method(), lib.viaHelper, lib["quoted-name"], lib.extra, lib.callsOwn(), a(), K, lib.missing);
console.log(lib.a.name, lib.anonymous.name, lib.arrow.name, lib.method.name);
