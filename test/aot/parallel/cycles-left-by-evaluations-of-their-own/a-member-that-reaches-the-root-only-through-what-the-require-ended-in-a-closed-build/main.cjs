// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can see every API this program uses
// The closed twin of ../a-member-that-reaches-the-root-only-through-what-the-require-ended. There the function lies on globalThis, and a call of a global that nobody knows opens the build as eval does. Here it lies in a leaf file and is called out of a list: THE BUILD MUST BE CLOSED, which the line above holds.
const STAGE = require("./stage.cjs");
STAGE.hook = () => require("./ended.mjs").ok;
try { console.log("root:", String(require("./root.mjs").ok)); } catch (error) { console.log("root:", error.message); }
try { console.log("late:", String(require("./late.mjs").ok)); } catch (error) { console.log("late:", error.message); }
try { console.log("ended:", String(require("./ended.mjs").ok)); } catch (error) { console.log("ended:", error.message); }
