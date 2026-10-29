import { describeError } from "./describe-error.mjs";
console.log("requires-itself starts");
try {
  require("./requires-itself.mjs");
} catch (error) {
  console.log("itself, before its await:", describeError(error));
}
await null;
console.log("requires-itself ends");
