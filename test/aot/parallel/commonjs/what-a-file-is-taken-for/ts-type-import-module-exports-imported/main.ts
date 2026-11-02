// @ts-expect-error TypeScript sees no export in a file that stores to module.exports
import config from "./config";
console.log(JSON.stringify(config));
