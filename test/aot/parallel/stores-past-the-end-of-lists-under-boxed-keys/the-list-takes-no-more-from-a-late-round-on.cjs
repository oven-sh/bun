// STATISTIC: StoresUnderAnyKeyThatRaiseTheLengthInLine >= 1
"use strict";
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

const open = [], shut = [], sealed = [], frozen = [];
function put(list, key, v) { try { list[key] = v; return list.length; } catch (e) { return e.constructor.name; } }
function step(r) { if (r === 6) { Object.preventExtensions(shut); Object.seal(sealed); Object.freeze(frozen); } const k = ids[r]; return [put(open, k, r), put(shut, k, r), put(sealed, k, r), put(frozen, k, r)].join(); }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
