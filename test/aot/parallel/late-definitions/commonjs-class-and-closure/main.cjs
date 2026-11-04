// The same in a CommonJS file.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
const { read } = require("./m.cjs");
say(() => [new (read()[0])().m(), read()[1](), read()[2].flags].join());
