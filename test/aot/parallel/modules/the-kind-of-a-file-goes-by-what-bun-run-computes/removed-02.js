if (1 === 2) require("node:path");
function typeOfThis() { return typeof this; }
let stored;
try { undeclared = 1; stored = "stored"; delete globalThis.undeclared; } catch (error) { stored = error.name; }
(globalThis.kinds ??= []).push("removed-02 " + typeOfThis() + " " + stored);
