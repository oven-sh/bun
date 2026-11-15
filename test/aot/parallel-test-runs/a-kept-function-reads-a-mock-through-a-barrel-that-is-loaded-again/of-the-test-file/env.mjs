globalThis.envs = (globalThis.envs ?? 0) + 1;
export let mode = 'real' + globalThis.envs;
export const set = value => { mode = value; };
