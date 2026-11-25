// The record of lib.mjs lists `sum` and `spare`, because a method that nobody calls hands its namespace object out. Nothing comes to `spare`: neither it nor what it alone calls is in the executable.
// STATISTIC: ImageFunctionsEmitted <= 5
import { sum } from "./lib.mjs";
const table = { used() { return 1; }, never() { return import("./lib.mjs"); } };
console.log(sum(1, 2) + table.used());
