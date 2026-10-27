// A wrapper that asks for define module and a global.
const t = require("./t.cjs");
console.log(JSON.stringify(t), t.f(), typeof globalThis.T);
