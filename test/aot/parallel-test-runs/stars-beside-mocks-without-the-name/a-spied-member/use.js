import * as all from './barrel.js';
export function use() { all.bump(); return all.f() + ' ' + all.count + ' ' + Object.keys(all).join(); }
