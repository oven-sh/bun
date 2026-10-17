globalThis.times = 0;
const out = [];
for (let i = 0; i < 4; ++i) { try { out.push("ok " + require("./m.cjs")) } catch (e) { out.push(e.message) } }
console.log("a module that threw is required again: " + out.join());
