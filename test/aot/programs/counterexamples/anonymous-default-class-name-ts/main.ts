// `export default class {}` in a TypeScript file is named "default".
declare const console: { log(...a: unknown[]): void };
import D from "./main.ts";
export default class {}
console.log(JSON.stringify(D.name));
