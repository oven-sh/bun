import { createRequire } from 'node:module';
const one = createRequire(import.meta.url)('./one.mjs');
const same = import.meta.require('./one.mjs');
export const look = () => String(one.sep) + String(same.sep);
