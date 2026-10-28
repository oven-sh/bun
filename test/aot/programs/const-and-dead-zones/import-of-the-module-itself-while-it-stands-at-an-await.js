// Import() of the module itself, answered while it stands at an await.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
import("./import-of-the-module-itself-while-it-stands-at-an-await.js").then(ns => seen.push("resolved " + attempt(() => ns.later.x)), e => seen.push("rejected"));
let wake; setTimeout(() => wake(), 5);
await new Promise(r => { wake = r; });
export const later = { x: 1 };
await null;
console.log(seen.join("|") || "nothing yet");
