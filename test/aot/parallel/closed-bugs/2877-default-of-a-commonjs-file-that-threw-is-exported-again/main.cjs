try {
  console.log("required", Object.keys(require("./module.mjs")).join());
} catch (error) {
  console.log("threw", error.name, error.message.split(" in module")[0]);
}
