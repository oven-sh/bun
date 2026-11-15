"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
const exec = RegExp.prototype.exec; for (const receiver of [{}, [], RegExp.prototype, "a", 1, null, undefined, () => {}, new Map(), Object.create(made("a{#}")), new Proxy(made("a{#}"), {})]) { try { log.push(show(exec.call(receiver, "aa"))); } catch (thrown) { log.push(thrown.constructor.name); } }
for (const subject of [undefined, null, 22, { toString() { return "aa"; } }, ["aa"], Symbol.iterator]) { try { log.push(show(made("(a{#}|2{#}|undefined|null)").exec(subject))); } catch (thrown) { log.push(thrown.constructor.name); } }
log.push(show(made("undefined").exec()));
console.log("SAID", log.join(" | "));
