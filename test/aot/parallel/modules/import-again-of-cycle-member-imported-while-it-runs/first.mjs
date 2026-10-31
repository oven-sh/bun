import "./second.mjs";
console.log("first begins");
import("./second.mjs").then(
  () => console.log("later import of second: fulfilled"),
  error => console.log("later import of second: rejected,", error.message),
);
console.log("first ends");
