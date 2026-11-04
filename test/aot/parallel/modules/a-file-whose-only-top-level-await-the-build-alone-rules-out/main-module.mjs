export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (import.meta.main) { await 0; }
