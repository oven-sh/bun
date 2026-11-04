export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (false) { for await (const each of []) {} }
