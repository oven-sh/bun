import "./below.mjs";
console.log("between runs");
import("./below.mjs").then(
  () => console.log("import of below called while the cycle ran: fulfilled"),
  error => console.log("import of below called while the cycle ran: rejected,", error.message),
);
