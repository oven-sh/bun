import "./ended.mjs";
console.log("throws begins");
import("./ended.mjs").then(
  () => console.log("import of ended: fulfilled"),
  error => console.log("import of ended: rejected,", error.message),
);
throw new Error("thrown by throws");
