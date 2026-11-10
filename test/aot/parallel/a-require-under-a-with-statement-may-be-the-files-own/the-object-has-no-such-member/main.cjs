const scope = { quiet: 1 };
with (scope) {
  console.log("SAID", require("./one.cjs").value, quiet);
}
