(globalThis.ran ??= []).push("dep");
await new Promise(resolve => setTimeout(resolve, 5));
(globalThis.ran ??= []).push("dep end");
export const d = "real d";
