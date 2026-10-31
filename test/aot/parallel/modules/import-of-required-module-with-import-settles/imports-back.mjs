console.log("imports-back runs");
import("./running.mjs").then(
  names => console.log("import of running: fulfilled, ended:", names.ended),
  error => console.log("import of running: rejected,", error.message),
);
