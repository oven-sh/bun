// The same in a CommonJS file.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
const { read } = require("./m.cjs");
say(() => [new (read()[0])().m(), read()[1](), read()[2].flags].join());
