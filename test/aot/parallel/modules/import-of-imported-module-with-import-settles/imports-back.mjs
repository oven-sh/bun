console.log("imports-back runs");
import("./running.mjs").then(
  names => console.log("second import of running: fulfilled, ended:", names.ended),
  error => console.log("second import of running: rejected,", error.message),
);
