globalThis.firstRunOfThrowerFails = true;
const said = [];
for (let i = 0; i < 2; i++) { try { said.push(typeof require("./lib-throws-once.cjs")); } catch (e) { said.push(e.message); } }
console.log(said.join(), globalThis.triesOfThrower, globalThis.keptByThrower());
