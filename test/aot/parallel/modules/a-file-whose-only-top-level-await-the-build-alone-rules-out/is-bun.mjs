export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (process.isBun === false) { await 0; }
