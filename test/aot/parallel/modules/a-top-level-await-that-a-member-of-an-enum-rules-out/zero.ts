// @ts-nocheck
export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
enum E { Z }
if (E.Z) { await import("./never.ts"); }
