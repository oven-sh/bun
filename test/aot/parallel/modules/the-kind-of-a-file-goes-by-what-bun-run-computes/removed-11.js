function f() { const a = false; if (a) { require("node:path"); } } f();
function typeOfThis() { return typeof this; }
let stored;
try { undeclared = 1; stored = "stored"; delete globalThis.undeclared; } catch (error) { stored = error.name; }
(globalThis.kinds ??= []).push("removed-11 " + typeOfThis() + " " + stored);
