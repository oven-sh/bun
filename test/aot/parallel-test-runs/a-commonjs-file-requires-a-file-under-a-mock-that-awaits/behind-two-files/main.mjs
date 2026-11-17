import { store } from './s.mjs';
import legacy from './a.mjs';
export const run = () => [store.size, legacy.size()].join();
