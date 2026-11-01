console.log("outer begins");
import("./first-to-end.mjs").then(
  () => console.log("import of first-to-end called before the cycle ran: fulfilled"),
  error => console.log("import of first-to-end called before the cycle ran: rejected,", error.message),
);
require("./root.mjs");
console.log("outer ends");
export {};
