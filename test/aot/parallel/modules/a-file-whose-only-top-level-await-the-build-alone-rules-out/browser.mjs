export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (process.browser) { await 0; }
