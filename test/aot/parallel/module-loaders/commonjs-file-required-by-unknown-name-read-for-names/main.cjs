// Every load of the file reads names alone, so the build could keep its exports as variables. A require() under a name
// that the build cannot know still answers with the object of the file.
const { used } = require("./lib/values.cjs");
const path = process.env.VALUES_PATH ?? "./lib/values.cjs";
const { unused } = require(path);
console.log(used(2), unused(2));
const other = require(path).other;
console.log(typeof other, other(2));
console.log(typeof require(path)?.unused, require(path).used === used, require(path).missing);
