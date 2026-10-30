// `module.children` lists a file once the require() of it has returned: not while its body runs, never if the body throws, and at once where the file is still running further up (a cycle).
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
const names = () => module.children.map(child => child.id.split(/[\\/]/).pop()).join();
exports.names = names;
require("./child.cjs");
console.log("behind the child:", names());
try {
  require("./thrower.cjs");
} catch (error) {
  console.log(error.message, "|", names());
}
require("./back.cjs");
console.log("behind the cycle:", names());
require("./child.cjs");
console.log("required again:", names());
