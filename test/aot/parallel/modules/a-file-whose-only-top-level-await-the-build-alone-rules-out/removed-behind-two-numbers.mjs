export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (1 > 2) { await 0; }
