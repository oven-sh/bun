(globalThis.ran ??= []).push("dep");
throw new Error("the body of dep");
export const d = "real d";
