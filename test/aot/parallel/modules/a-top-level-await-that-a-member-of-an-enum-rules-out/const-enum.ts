// @ts-nocheck
export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
const enum E { Z }
if (E.Z) { await 0; }
