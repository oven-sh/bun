// node:fs defines some members with getters. Listing the members reads all of them.
import fs from "node:fs";
const returned = JSON.parse("1", () => fs);
console.log(Object.values(returned).length, Object.entries(returned).length);
console.log(Object.keys({ ...returned }).length, Object.keys(Object.assign({}, returned)).length);
console.log(Object.values(returned).filter(value => value === undefined).length);
