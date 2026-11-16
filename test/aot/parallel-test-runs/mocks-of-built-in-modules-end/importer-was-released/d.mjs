import { p } from 'pkg'; import { basename } from 'node:path'; export const d = () => [p(), basename('/x/y')].join();
