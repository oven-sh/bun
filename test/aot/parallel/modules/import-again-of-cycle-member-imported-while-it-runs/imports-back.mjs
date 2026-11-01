console.log("imports-back runs");
import("./second.mjs").then(
  () => console.log("import of second while it runs: fulfilled"),
  error => console.log("import of second while it runs: rejected,", error.message),
);
