console.log("imports-later runs");
import("./running.mjs").then(
  names => console.log("later import of running: fulfilled, ended:", names.ended),
  error => console.log("later import of running: rejected,", error.message),
);
