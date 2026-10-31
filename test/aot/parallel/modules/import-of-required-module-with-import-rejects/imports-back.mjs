console.log("imports-back runs");
import("./running.mjs").then(
  () => console.log("import of running: fulfilled"),
  error => console.log("import of running: rejected,", error.message, "| the error that require threw:", error === globalThis.thrownByRunning),
);
