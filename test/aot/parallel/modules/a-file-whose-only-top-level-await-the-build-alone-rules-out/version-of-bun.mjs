export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
if (!process.versions.bun) { await 0; }
