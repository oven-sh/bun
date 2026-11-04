export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (0) await 0;
