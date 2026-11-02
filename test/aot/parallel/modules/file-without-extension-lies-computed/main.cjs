// `require(__dirname + "/" + name)` may name any file of the folder, and a licence lies there, as in many packages. It is no part of the program: the build does not read it as JavaScript.
// Whoever does ask for it gets an error, as under `bun run`, which stops at its second word.
const load = name => require(__dirname + "/" + name);
console.log(load(["part", "cjs"].join(".")).name);
try {
  load(["LIC", "ENSE"].join(""));
  console.log("loaded");
} catch (error) {
  console.log("threw", error instanceof Error);
}
