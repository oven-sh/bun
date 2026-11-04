export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
while (false) { await 0; }
