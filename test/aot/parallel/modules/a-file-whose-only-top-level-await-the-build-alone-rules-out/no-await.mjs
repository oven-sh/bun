export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
