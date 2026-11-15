// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can't tell which API this program uses at helper.mjs:2:24, because the name is only known at run time
// Build prints: 0 x aot: trim: the compiler can see every API this program uses
// The closed twin of ../required-by-a-hook-while-the-cycle-runs. There the function lies on globalThis, and a call of a global that nobody knows opens the build as eval does. Here it lies in a leaf file and is called out of a list: THE BUILD MUST BE CLOSED, which the line above holds.
const STAGE = require("./stage.cjs");
STAGE.hook = () => require("./outside.mjs").seen;
try { require("./first.mjs"); } catch (error) { console.log("first:", error.message); }
try { console.log("second:", require("./second.mjs").ok); } catch (error) { console.log("second:", error.message); }
try { console.log("outside:", require("./outside.mjs").seen); } catch (error) { console.log("outside:", error.message); }
try { require("./first.mjs"); } catch (error) { console.log("first again:", error.message); }
