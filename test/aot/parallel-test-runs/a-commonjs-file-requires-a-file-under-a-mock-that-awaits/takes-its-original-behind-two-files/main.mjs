import { legacy, store } from './s.mjs';
export const run = () => [store.size, legacy.size()].join();
