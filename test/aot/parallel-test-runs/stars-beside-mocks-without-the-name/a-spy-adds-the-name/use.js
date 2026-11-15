import { f } from './barrel.js';
import * as all from './barrel.js';
export function use() { return typeof f + ' ' + typeof all.f + ' ' + (f && f()); }
