function load() {
  try {
    import.meta.require("./thrower.cjs");
  } catch (error) {
    console.log("required: " + error.message);
  }
}
await import("./thrower.cjs").catch(error => console.log("imported: " + error.message));
load();
load();
await import("./thrower.cjs").catch(error => console.log("imported: " + error.message));
