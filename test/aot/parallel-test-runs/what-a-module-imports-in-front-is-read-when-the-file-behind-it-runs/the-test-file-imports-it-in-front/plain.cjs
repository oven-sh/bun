let mode = "strict";
try { undeclared = 1; mode = "sloppy"; } catch {}
console.log("plain", mode);
