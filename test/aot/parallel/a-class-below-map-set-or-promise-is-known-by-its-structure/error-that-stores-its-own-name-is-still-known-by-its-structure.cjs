// A class below Error stores this.name, which is a member of Error.prototype too: a name that the class lists as a field does not refuse the structure.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: operation:operationAOTFillSiteCache = 0
"use strict";
const turns = +(process.argv[2] ?? 300);
class Named extends Error { constructor(message, code) { super(message); this.name = "Named"; this.code = code; } }
const fault = new Named("went wrong", 7);
function read(e) { return e.code + e.name.length; }
let sum = 0;
for (let t = 0; t < turns; t++) sum += read(fault);
console.log("SAID", "named", sum, fault.name, String(fault));
