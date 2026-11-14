function load(on) {
  if (!on) return;
  try {
    require("./thrower.cjs");
  } catch (error) {
    console.log("required: " + error.message);
  }
}
load(true);
import("./thrower.cjs")
  .catch(error => console.log("imported: " + error.message))
  .then(() => load(true));
load(true);
