import { mode } from './env.mjs';
console.log('SAID store runs');
export let writes = 0;
export const write = () => ++writes;
export const read = () => mode;
