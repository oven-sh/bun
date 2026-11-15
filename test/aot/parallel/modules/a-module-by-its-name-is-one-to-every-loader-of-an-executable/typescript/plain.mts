let mode = "strict";
// @ts-ignore
try { undeclared = 1; mode = "sloppy"; } catch {}
((globalThis as any).seen ??= []).push("plain-" + mode);
