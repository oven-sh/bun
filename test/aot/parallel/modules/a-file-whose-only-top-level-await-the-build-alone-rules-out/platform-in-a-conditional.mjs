export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
const picked = process.platform === "no such platform" ? await 0 : 1;
