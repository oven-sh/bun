// A required module is imported by what it imports while it is evaluated.
console.log("the entry point begins");
const outer = require("./outer.mjs");
console.log("required", Object.keys(outer).join());
setTimeout(async () => {
  const again = await import("./outer.mjs");
  console.log("imported again", again.name, again === outer);
}, 1);
console.log("the entry point ends");
