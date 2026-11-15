import { p } from './pk.mjs'; import { basename } from 'node:path'; export const d = () => [p(), basename('/x/y')].join();
