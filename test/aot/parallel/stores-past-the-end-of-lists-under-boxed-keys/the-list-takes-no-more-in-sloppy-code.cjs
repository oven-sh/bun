// STATISTIC: StoresUnderAnyKeyThatRaiseTheLengthInLine >= 1
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

const shut = [], frozen = [];
function put(list, key, v) { list[key] = v; return list.length; }
function step(r) { if (r === 6) { Object.preventExtensions(shut); Object.freeze(frozen); } return put(shut, ids[r], r) + ":" + put(frozen, ids[r >> 1], r) + ":" + frozen[r >> 1]; }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
