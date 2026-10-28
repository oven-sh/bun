globalThis.kept ??= [];
const state = { n: 0, list: [] };
const bump = () => ++state.n;
globalThis.kept.push({ state, bump });
if (globalThis.kept.length === 1) throw new Error("first run");
module.exports = { state, bump };
