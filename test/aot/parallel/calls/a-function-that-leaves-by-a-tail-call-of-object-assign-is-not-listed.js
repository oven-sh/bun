// `function lastAssign(given) { return Object.assign({}, given); }`: strict code: the function leaves by a tail call: where a getter of the source throws, the stack lists the getter and `assign` and not the function.
// Copied in line in a loop the call is written out by the layouts that its sources are expected to have; what is left of it as written stands for the written call and bears its mark.
"use strict";
const framesOf = error => error.stack.split("\n").slice(1).map(line => /at (\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ").split(" < attempt")[0];
function lastAssign(given) { return Object.assign({}, given); }
function lastAssignOne(given) { return Object.assign({ a: 1 }, given); }
function lastAssignTwo(given) { return Object.assign({}, { x: 1 }, given); }
function lastAssignThree(given) { return Object.assign({}, given, { x: 1 }); }
function lastAssignBoth(given) { return Object.assign({}, given, given); }
function keptAssign(given) { const made = Object.assign({}, given); return made.worth + 0; }
function keptAssignTwo(given) { const made = Object.assign({}, { x: 1 }, given); return made.worth + 0; }
function keptSpread(given) { return { ...given }; }
function attempt(name, f) { try { console.log(name, JSON.stringify(f())); } catch (error) { console.log(name, error.constructor.name, "|", framesOf(error)); } }
const kinds = { bad: () => ({ get worth() { throw new Error("no"); } }), good: () => ({ worth: 1 }) };
for (let round = 0; round < 3; round++) {
  for (const [kind, make] of Object.entries(kinds)) {
    const show = round === 2 ? attempt : (name, f) => { try { f(); } catch { } };
    show(kind + " lastAssign", () => { const given = make(); return [lastAssign(given), 1]; });
    show(kind + " lastAssignOne", () => { const given = make(); return [lastAssignOne(given), 1]; });
    show(kind + " lastAssignTwo", () => { const given = make(); return [lastAssignTwo(given), 1]; });
    show(kind + " lastAssignThree", () => { const given = make(); return [lastAssignThree(given), 1]; });
    show(kind + " lastAssignBoth", () => { const given = make(); return [lastAssignBoth(given), 1]; });
    show(kind + " keptAssign", () => { const given = make(); return [keptAssign(given), 1]; });
    show(kind + " keptAssignTwo", () => { const given = make(); return [keptAssignTwo(given), 1]; });
    show(kind + " keptSpread", () => { const given = make(); return [keptSpread(given), 1]; });
  }
}
