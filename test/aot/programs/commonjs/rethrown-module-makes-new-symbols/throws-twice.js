"use strict";
const kOwn = Symbol("own");
seen.push(kOwn);
holder[kOwn] = seen.length;
if (seen.length < 3) throw new Error("thrown at load, time " + seen.length);
function readOwn(object) { return object[kOwn]; }
module.exports = { kOwn, readOwn, stamp(object) { object[kOwn] = "stamped"; return object; } };
