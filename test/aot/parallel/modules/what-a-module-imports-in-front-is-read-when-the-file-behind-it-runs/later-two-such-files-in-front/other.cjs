let mode = "strict";
try { undeclaredother = 1; mode = "sloppy"; } catch {}
console.log("other", mode);
