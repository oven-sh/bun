// util.promisify goes by the function that lies under its own symbol, read off it or asked of the registry.
import { promisify } from "node:util";
function old(value, callback) { callback(null, value + 1); }
old[promisify.custom] = value => Promise.resolve("custom " + value);
console.log(await promisify(old)(1));
function other(value, callback) { callback(null, value + 1); }
other[Symbol.for("nodejs.util.promisify.custom")] = value => Promise.resolve("registered " + value);
console.log(await promisify(other)(1));
console.log(await promisify(setTimeout)(1, "timer"));
