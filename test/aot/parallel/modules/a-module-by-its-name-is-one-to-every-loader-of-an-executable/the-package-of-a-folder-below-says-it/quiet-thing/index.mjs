let mode = "strict";
try { undeclared = 1; mode = "sloppy"; } catch {}
(globalThis.seen ??= []).push("quiet-" + mode);
