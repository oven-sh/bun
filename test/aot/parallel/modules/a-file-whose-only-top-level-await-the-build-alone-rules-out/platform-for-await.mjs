export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (process.platform === "no such platform") { for await (const each of []) {} }
