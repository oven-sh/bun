export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (typeof Bun === "undefined") { await 0; }
