// What TypeScript emits for a barrel (`export * from "./shapes"; export { describe } from "./describe"`) and a module that imports from the barrel it is exported by. The module finds the barrel half done: the star has run, the getter of `describe` is not defined yet.
const index = require("./index");
const describe = require("./describe");
console.log(Object.keys(index).join(), index.describe(new index.Square()), describe.unitAtLoad, describe.describeAtLoad);
