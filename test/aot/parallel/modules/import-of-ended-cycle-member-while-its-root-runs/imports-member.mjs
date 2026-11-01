console.log("imports-member runs");
import("./member.mjs").then(
  () => console.log("import of member while its root runs: fulfilled"),
  error => console.log("import of member while its root runs: rejected,", error.message),
);
