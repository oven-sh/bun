// effects.js runs for what it prints. Only a function that nothing calls uses what it imports, and each package says "sideEffects": false, so the packages are left
// out, and with them what only they name: a package that the build does not compile, a URL, a literal text that is compiled like a file.
// Flags: --external outside
import "./effects.js";
console.log("main");
