try {
  require("./lib.mjs");
} catch (error) {
  console.log("preload", error.name, error.message);
}
