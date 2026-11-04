// The same in a CommonJS file.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
const L = require("./m.cjs");
say(() => [Object.keys(L).join("/"), JSON.stringify(Object.entries(L).map(([k, v]) => typeof v)), new L.A().m(), L.f(), L.g(), L.h()].join());
