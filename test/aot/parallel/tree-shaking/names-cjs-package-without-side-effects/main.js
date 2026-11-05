// effects.js runs for what it prints. The names that it imports from CommonJS packages are used only in a function that nothing calls, and each package says
// "sideEffects": false, so the packages are left out. Most of them make their exports in a way that only a run can tell the names of.
import "./effects.js";
import "./another.js";
import "./requires.cjs";
console.log("main");
