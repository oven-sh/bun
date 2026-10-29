import { one } from "./step.mjs";
console.log("the entry point runs");
try {
  console.log(one);
} catch (error) {
  console.log(error.name);
}
