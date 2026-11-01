// The function that a field holds is CALLED before anything reads the field. It sees the same function object that the field gives later, and what it captured.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
const { make } = require("./m.cjs");
const o = make();
const seen = o.f();
say(() => [seen === o.f, typeof seen].join());
