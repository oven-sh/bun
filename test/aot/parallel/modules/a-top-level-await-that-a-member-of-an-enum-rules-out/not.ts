// @ts-nocheck
export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
enum E { A = 1 }
if (!E.A) { await 0; }
