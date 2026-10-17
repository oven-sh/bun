export const held = require("./lib") as typeof import("./lib");
export const loose = require("./lib");
export default require("./lib") as typeof import("./lib");
const inner = require("./lib") as typeof import("./lib");
export { inner as renamed };
export function give() { return inner; }
export class Keeps { static lib = inner; own = held; }
export const table = { lib: held, list: [loose] };
