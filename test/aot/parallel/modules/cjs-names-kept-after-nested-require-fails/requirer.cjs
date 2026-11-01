try {
  require("./outer.mjs");
  console.log("outer.mjs required");
} catch (error) {
  console.log("outer.mjs threw", error.name, error.message.replace(/'[^']*[\\/]/, "'"));
}
