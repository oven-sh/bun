console.log("imports-back runs");
import("./running.mjs").then(
  names => console.log("import of running: fulfilled, names:", Object.keys(names).length),
  error => console.log("import of running: rejected,", error.message),
);
