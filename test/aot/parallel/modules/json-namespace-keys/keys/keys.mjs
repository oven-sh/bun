import * as ns from "./data.json";
import whole from "./data.json";
const held = ns;
console.log(
  Object.keys(held).join(),
  "|",
  Object.keys(whole).join(),
  "|",
  Object.getOwnPropertyNames(held).join(),
  "|",
  held.default === whole,
);
for (const key in held) console.log("in", key);
console.log(JSON.stringify(held), JSON.stringify({ ...held }));
