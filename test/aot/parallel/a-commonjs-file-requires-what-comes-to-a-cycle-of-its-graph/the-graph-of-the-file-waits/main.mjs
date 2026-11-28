import "./tools.cjs";
import { count } from "./feed.mjs";
export var title = "main";
console.log("main begins");
try {
  console.log("main reads", count);
} catch (error) {
  console.log("main reads and throws", error.name);
}
setTimeout(() => console.log("the end", count), 1);
