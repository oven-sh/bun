/// <reference path="./ambient.d.ts" />
import { before } from "./before";
console.log("the statements in front of it run", before);
import missing = require("not-installed");
console.log("never runs", missing);
export function one(): number {
  return 1;
}
