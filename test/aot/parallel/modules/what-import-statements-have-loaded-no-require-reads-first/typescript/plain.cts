let mode: string = "strict";
try { (undeclared as any) = 1; mode = "sloppy"; } catch {}
((globalThis as any).seen ??= []).push("plain-" + mode);
declare let undeclared: unknown;
