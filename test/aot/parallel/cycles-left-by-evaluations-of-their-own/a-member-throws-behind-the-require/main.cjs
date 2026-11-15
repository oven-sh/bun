globalThis.hook = () => require("./outside.mjs").seen;
try { console.log("first:", String(require("./first.mjs").ok)); } catch (error) { console.log("first:", error.message); }
try { console.log("middle:", String(require("./middle.mjs").ok)); } catch (error) { console.log("middle:", error.message); }
try { console.log("last:", String(require("./last.mjs").ok)); } catch (error) { console.log("last:", error.message); }
try { console.log("outside:", String(require("./outside.mjs").ok)); } catch (error) { console.log("outside:", error.message); }
