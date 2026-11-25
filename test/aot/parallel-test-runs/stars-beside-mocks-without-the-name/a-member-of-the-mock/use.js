import * as all from './barrel.js';
export function use() { all.bump(); return typeof all.f + ' ' + all.count + ' ' + Object.keys(all).join(); }
