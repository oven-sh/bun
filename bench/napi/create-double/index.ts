import { bench, group, run } from "../../runner.mjs";
const napi_module = require("./build/Release/create-double.node");

let sum = 0.0;
for (let i = 0; i < 100_000_000; i++) {
  sum += napi_module.nativeFunc();
}

console.log("Result", sum);
