export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
function never() {}
if (process.platform === "no such platform") { never(await 0); }
