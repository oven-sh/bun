export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if ("a" === "b") { await 0; }
