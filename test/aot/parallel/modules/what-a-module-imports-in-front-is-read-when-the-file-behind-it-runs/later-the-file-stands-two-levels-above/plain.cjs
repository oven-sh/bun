let mode = "strict";
try { undeclaredplain = 1; mode = "sloppy"; } catch {}
console.log("plain", mode);
