export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (process.arch === "no such architecture") { await 0; }
