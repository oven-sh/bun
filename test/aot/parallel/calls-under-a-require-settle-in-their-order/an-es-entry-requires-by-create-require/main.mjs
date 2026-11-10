import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const line = [];
globalThis.log = word => line.push(word);
globalThis.keep = (name, promise) => promise.then(() => line.push(name + "+"), error => line.push(name + "!" + (error && error.message)));
try { require("./first.mjs"); log("+"); } catch (error) { log("threw " + (error && error.message)); }
setTimeout(() => console.log(line.join(" ")), 200);
