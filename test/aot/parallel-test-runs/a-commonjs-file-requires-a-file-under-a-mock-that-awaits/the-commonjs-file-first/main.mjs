import legacy from './legacy.cjs';
import { store } from './store.mjs';
export const run = () => [store.size, legacy.size()].join();
