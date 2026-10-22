// node:dgram is named in a function that nobody calls, node:zlib in an arm that a constant condition removes, node:readline in a function that is called. Only what the program can reach is in the executable: neither the function that is left out nor the arm that is removed keeps a module. Plain Bun finds all three.
function nobodyCalls() {
  return require("node:dgram");
}
if (false) require("node:zlib");
function called() {
  return require("node:readline");
}
console.log(typeof called());

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
