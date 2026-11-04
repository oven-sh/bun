const unseen = (0, eval)("(load, name) => load(name).seen");
globalThis.hook = () => unseen(require, "./outside.mjs");
if (Date.now() < 0) require("./outside.mjs");
try { console.log("first:", String(require("./first.mjs").ok)); } catch (error) { console.log("first:", error.message); }
try { console.log("second:", String(require("./second.mjs").ok)); } catch (error) { console.log("second:", error.message); }
