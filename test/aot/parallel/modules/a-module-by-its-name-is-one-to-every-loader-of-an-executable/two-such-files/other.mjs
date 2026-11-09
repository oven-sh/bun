let mode = "strict";
try { undeclaredOther = 1; mode = "sloppy"; } catch {}
(globalThis.seen ??= []).push("other-" + mode);
