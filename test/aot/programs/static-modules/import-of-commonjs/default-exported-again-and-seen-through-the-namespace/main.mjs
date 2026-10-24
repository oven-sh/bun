import * as barrel from "./barrel.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof barrel.old, barrel.old.name, barrel.old.make().length);
const key = ["o", "l", "d"].join("");
console.log(barrel[key].name);
