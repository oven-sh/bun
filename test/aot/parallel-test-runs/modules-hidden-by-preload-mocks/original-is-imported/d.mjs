import { basename } from 'node:path';
import { e } from './deep.mjs';
export const get = () => basename('/x/y') + e();
