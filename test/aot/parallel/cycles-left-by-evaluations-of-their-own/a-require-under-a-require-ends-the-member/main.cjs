globalThis.hook = () => require("./outside.mjs").seen;
globalThis.deeper = () => require("./inner.mjs").seen;
try { console.log("first:", String(require("./first.mjs").ok)); } catch (error) { console.log("first:", error.message); }
try { console.log("second:", String(require("./second.mjs").ok)); } catch (error) { console.log("second:", error.message); }
try { console.log("third:", String(require("./third.mjs").ok)); } catch (error) { console.log("third:", error.message); }
