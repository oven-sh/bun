// The body of the file throws. A variable whose declaration it never reached stays in its dead zone, and one that it passed holds its value.
// Alone: what is put off goes by all that the executable holds
const registry = require("./registry.cjs");
try { require("./m.cjs"); } catch (e) { console.log("caught", e.message); }
try { console.log(registry[0]()); } catch (e) { console.log(e.name + ": " + e.message); }
