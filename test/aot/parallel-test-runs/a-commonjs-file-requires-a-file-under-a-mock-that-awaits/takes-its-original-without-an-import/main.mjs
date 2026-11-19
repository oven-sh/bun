import legacy from './legacy.cjs';
const store = { size: 'none' };
export const run = () => [store.size, legacy.size()].join();
