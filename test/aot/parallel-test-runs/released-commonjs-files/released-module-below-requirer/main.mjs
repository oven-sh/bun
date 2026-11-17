import { write, writes } from './store.mjs';
import legacy from './legacy.cjs';
export const run = () => [write(), writes, legacy.raw.writes, legacy.raw.write === write].join();
