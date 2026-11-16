"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
const all = made("a{#}", "g"), text = "aa.aaa.aaaa"; for (let turn = 0; turn < 7; turn++) log.push(show(all.exec(text)) + ":" + all.lastIndex);
const sticky = made("b{#}", "y"); for (const at of [0, 1, 2, 9, -1, 2.5, "1", { valueOf() { log.push("asked"); return 1; } }]) { sticky.lastIndex = at; log.push(show(sticky.exec("abbbb")) + ":" + String(sticky.lastIndex)); }
const fixed = made("c{#}", "g"); Object.defineProperty(fixed, "lastIndex", { writable: false, value: 0 }); for (const subject of ["xccx", "x"]) { try { log.push(show(fixed.exec(subject))); } catch (thrown) { log.push(thrown.constructor.name); } }
const plain = made("(d{#})[d]?"); plain.lastIndex = 5; for (let turn = 0; turn < 3; turn++) log.push(show(plain.exec("ddd")) + ":" + plain.lastIndex); plain.lastIndex = "x"; log.push(show(plain.exec("ddd")) + ":" + plain.lastIndex);
console.log("SAID", log.join(" | "));
