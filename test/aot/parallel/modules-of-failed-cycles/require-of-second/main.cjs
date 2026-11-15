try {
  require("./a.mjs");
  console.log("a loads");
} catch (error) {
  console.log("a", error.message);
}
try {
  require("./b.mjs");
  console.log("b loads");
} catch (error) {
  console.log("b", error.message);
}
