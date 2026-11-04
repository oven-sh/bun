f(); const no = false; if (no) require("node:path"); function f() {}
function typeOfThis() { return typeof this; }
let stored;
try { undeclared = 1; stored = "stored"; delete globalThis.undeclared; } catch (error) { stored = error.name; }
(globalThis.kinds ??= []).push("kept-01 " + typeOfThis() + " " + stored);
