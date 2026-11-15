import { createRequire } from 'node:module';
const path = createRequire(import.meta.url)('node:path');
export const read = x => path.basename(x);
