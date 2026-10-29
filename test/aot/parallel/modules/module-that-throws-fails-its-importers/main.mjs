// A module that throws fails everything above it, once, with one error object.
import { bodies } from "./log.mjs";
const caught = imported => imported.then(() => "fulfilled", error => error);
const first = await caught(import("./chain-0.mjs"));
const bodiesAfterFirst = bodies.length;
console.log(first.message);
console.log("second import", (await caught(import("./chain-0.mjs"))) === first);
console.log("above", (await caught(import("./chain-2.mjs"))) === first);
console.log("thrower", (await caught(import("./chain-3.mjs"))) === first);
console.log("below", await caught(import("./chain-4.mjs")));
console.log("sibling", await caught(import("./sibling-0.mjs")));
console.log("bodies", bodiesAfterFirst, bodies.length);
