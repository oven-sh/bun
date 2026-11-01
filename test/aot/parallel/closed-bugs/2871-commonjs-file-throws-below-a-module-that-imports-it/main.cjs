try {
  require("./module.mjs");
  console.log("required");
} catch (error) {
  console.log("threw", error.name, error.message.split(" in module")[0]);
}
