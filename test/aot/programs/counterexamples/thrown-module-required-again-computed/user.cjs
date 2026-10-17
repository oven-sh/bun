globalThis.times = 0;
const out = [];
const name = "./m" + (globalThis.times ? "x" : "") + ".cjs";
for (let i = 0; i < 4; ++i) { try { out.push("ok " + require(name)) } catch (e) { out.push(e.message) } }
console.log("the same by a computed name: " + out.join());
