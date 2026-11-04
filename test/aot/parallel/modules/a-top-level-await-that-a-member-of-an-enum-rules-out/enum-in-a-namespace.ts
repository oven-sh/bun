// @ts-nocheck
export const state = { ready: false };
Promise.resolve().then(() => { state.ready = true; });
namespace N { export enum E { Z } }
if (N.E.Z) { await 0; }
