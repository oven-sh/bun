import { store } from './store.mjs';
import legacy from './legacy.cjs';
export const run = () => [store.size, legacy.size()].join();
