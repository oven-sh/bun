import "./requires.mjs";
import "./behind.mjs";
console.log("first begins");
import("./behind.mjs").then(
  () => console.log("import of behind: fulfilled"),
  error => console.log("import of behind: rejected,", error.message),
);
throw new Error("thrown by first");
