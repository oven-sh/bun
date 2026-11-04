// @ts-nocheck
export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (E.Z) { await 0; }
enum E { Z }
