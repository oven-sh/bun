// A module that exports then is imported by call.
const got = await import("./thenable.mjs");
console.log(typeof got, got === "resolved by then" ? got : Object.keys(got).join());
import * as ns from "./thenable.mjs";
console.log(typeof ns.then, await Promise.resolve(1).then(() => ns));
