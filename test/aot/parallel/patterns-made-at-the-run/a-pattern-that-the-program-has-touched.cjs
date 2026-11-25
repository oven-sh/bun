"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
const exec = RegExp.prototype.exec;
const named = made("(a{#})"); named.state = { n }; delete named.state; for (let turn = 0; turn < 3; turn++) log.push(show(named.exec("xaay")));
const kept = made("(b{#})"); kept.extra = 1; log.push(show(kept.exec("xbby")), kept.extra);
const own = made("(c{#})"); own.exec = () => { log.push("own"); return null; }; log.push(show(own.exec("xccy")), show(exec.call(own, "xccy")), own.test("xccy"));
class Below extends RegExp { exec(text) { log.push("below"); return super.exec(text); } } const below = new Below("(d{" + n + "})"); log.push(show(below.exec("xddy")), show(exec.call(below, "xddy")), below.test("xddy"));
const frozen = Object.freeze(made("(e{#})")); log.push(show(frozen.exec("xeey"))); const frozenAll = Object.freeze(made("(e{#})", "g")); try { log.push(show(frozenAll.exec("xeey"))); } catch (thrown) { log.push(thrown.constructor.name); }
const moved = made("(f{#})"); Object.setPrototypeOf(moved, { exec }); log.push(show(moved.exec("xffy")));
console.log("SAID", log.join(" | "));
