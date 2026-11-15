import { q } from './db.mjs';
import * as db from './db.mjs';
globalThis.rs = (globalThis.rs ?? 0) + 1;
console.log('R load service', globalThis.rs);
export const at = globalThis.rs;
export const read = () => q;
export const keys = () => Object.keys(db).join();
export const same = async () => db === await import('./db.mjs');
