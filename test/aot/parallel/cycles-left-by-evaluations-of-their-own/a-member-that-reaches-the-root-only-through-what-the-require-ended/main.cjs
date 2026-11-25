globalThis.hook = () => require("./ended.mjs").ok;
try { console.log("root:", String(require("./root.mjs").ok)); } catch (error) { console.log("root:", error.message); }
try { console.log("late:", String(require("./late.mjs").ok)); } catch (error) { console.log("late:", error.message); }
try { console.log("ended:", String(require("./ended.mjs").ok)); } catch (error) { console.log("ended:", error.message); }
