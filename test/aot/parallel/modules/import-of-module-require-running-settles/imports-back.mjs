globalThis.state = "pending";
import("./running.mjs").then(names => {
  globalThis.state = "got " + names.value;
});
