// What TypeScript emits for `export { Square } from "./shapes"`: `exports.Square = void 0`, then a getter that returns the member of the other module.
const i = require("./index");
console.log(typeof i.Square, Object.keys(i).join(), i.__esModule);
