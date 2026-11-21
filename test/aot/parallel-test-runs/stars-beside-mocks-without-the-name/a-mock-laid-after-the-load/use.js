import { f, count, bump } from './barrel.js';
export function use() { bump(); return f() + ' ' + count; }
