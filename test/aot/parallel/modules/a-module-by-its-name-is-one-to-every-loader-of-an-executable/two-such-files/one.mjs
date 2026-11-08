let mode = "strict";
try { undeclaredOne = 1; mode = "sloppy"; } catch {}
(globalThis.seen ??= []).push("one-" + mode);
