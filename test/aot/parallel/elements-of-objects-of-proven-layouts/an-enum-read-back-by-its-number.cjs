"use strict";
const log = [];
const outside = JSON.parse('[0, 1, 2, 3, -1, "Warn", 1.5]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
var Level; (function (Level) { Level[Level["Debug"] = 0] = "Debug"; Level[Level["Info"] = 1] = "Info"; Level[Level["Warn"] = 2] = "Warn"; })(Level || (Level = {}));
function name(n) { return Level[n]; } function same(t) { let s = 0; for (let i = 0; i < 10; i++) s += (Level[Level.Warn] === "Warn" ? 2 : 1) + (i & t); return s; }
for (const n of outside) say(name(n)); for (let t = 0; t < 3; t++) say(same(t)); Level[2] = "Changed"; say(same(1)); say(name(2)); delete Level[1]; say(name(1));
console.log("SAID", log.join(" | "));
