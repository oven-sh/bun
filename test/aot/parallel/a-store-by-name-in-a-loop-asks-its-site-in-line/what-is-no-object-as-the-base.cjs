// null, undefined and every kind of primitive come where objects came; a setter stands above numbers.
// STATISTIC: StoresByNameThatAskTheirSitesInLine >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
let heard = 0; Object.defineProperty(Number.prototype, "lid", { set(v) { heard += v; }, configurable: true });
for (const odd of [null, undefined, 7, 1.5, "text", true, Symbol("s"), 10n]) { const crates = plain(3); tell(() => fill(crates, 3000)); crates.push(odd); try { fill(crates, 4000); said.push("went through"); } catch (error) { said.push(error.constructor.name); } tell(() => crates.slice(0, 3).map(c => c.lid).join(",")); }
tell(() => heard);
console.log(said.join(" | "));
