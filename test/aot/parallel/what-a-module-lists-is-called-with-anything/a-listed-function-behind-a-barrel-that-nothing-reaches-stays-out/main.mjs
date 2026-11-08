// As beside it, with the names handed on by a star: the record of the barrel lists what the record of lib.mjs lists.
// STATISTIC: ImageFunctionsEmitted <= 5
import { sum } from "./barrel.mjs";
const table = { used() { return 1; }, never() { return import("./barrel.mjs"); } };
console.log(sum(1, 2) + table.used());
