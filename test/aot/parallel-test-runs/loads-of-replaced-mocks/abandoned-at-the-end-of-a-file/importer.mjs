import { data } from './part.mjs';
globalThis.bodies = (globalThis.bodies ?? 0) + 1;
console.log('SAID body ' + globalThis.bodies + ' ' + data);
export const read = () => data;
