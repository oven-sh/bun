// STATISTIC: StoresUnderAnyKeyThatRaiseTheLengthInLine >= 1
"use strict";
const keys = JSON.parse('[0,1,"2",3,"x",4,-1,5,1.5,6,"07",7,null,8]');
const list = [];
function put(key, v) { list[key] = v; return list.length; }
function step(r) { return put(keys[r], r) + ":" + Object.keys(list).join("")+ ":" + String(list[keys[r]]); }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
