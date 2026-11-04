const all = require("./classes.mjs");
console.log(Object.keys(all).join(), typeof all.Shown, new all.Shown().m(), all.Shown.name, all.Shown === require("./classes.mjs").Shown);
import("./classes.mjs").then(namespace => {
  console.log(namespace.Shown === all.Shown, new namespace.Below().m());
});
