import "./member.mjs";
console.log("root begins");
require("./imports-member.mjs");
import("./member.mjs").then(
  () => console.log("import of member behind the cycle: fulfilled"),
  error => console.log("import of member behind the cycle: rejected,", error.message),
);
console.log("root ends");
