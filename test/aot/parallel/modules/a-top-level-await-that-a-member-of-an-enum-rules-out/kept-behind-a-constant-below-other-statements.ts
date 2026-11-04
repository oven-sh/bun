// @ts-nocheck
export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
enum E { Z }
const z = E.Z;
if (z) { await 0; }
