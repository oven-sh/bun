// The program stores another object under the name: every read behind the store finds it, also where the same function has read the first one before.
function environment() { return process.env; }
function list() { return process.argv; }
function executable() { return process.execPath; }
const before = environment();
const listBefore = list();
const executableBefore = executable();
console.log(before === process.env, Array.isArray(listBefore), listBefore === list(), typeof executableBefore, executableBefore === executable());
const replacement = { ONLY: "this" };
process.env = replacement;
console.log(Object.keys(environment()).join(), environment().ONLY, environment() === before);
process.argv = ["a", "b"];
console.log(list().join(), process.argv.length, list() === listBefore);
process.execPath = "elsewhere";
console.log(executable(), process.execPath, executable() === executableBefore);
for (let i = 0; i < 3; i++) console.log(environment().ONLY, list()[i & 1], executable());
