globalThis.N = (globalThis.N ?? 0) + 1;
globalThis.said?.push('run dep');
export const x = 'real' + globalThis.N;
