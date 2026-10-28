console.log("the entry point begins");
try {
  require("./outer.mjs");
} catch (error) {
  console.log("require throws", error.name);
}
console.log("the entry point ends");
