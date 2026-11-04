export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
const DEV = false;
if (DEV) { await 0; }
