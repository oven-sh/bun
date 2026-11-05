const show = v => (v === null ? "null" : typeof v) + "{" + Reflect.ownKeys(Object(v)).filter(k => typeof k === "string").sort().join() + "}" + (Object.prototype.toString.call(v));
setTimeout(() => { const m = require("./file.cjs"); console.log("late", show(m), m === require("./file.cjs"), show(m.default), readOwn()); }, 1);
