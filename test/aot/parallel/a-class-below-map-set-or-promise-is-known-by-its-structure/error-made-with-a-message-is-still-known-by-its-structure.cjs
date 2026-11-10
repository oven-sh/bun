// An object of a class below Error that was made with a message has an own message: the table files that name under the prototype, and the examination passes it over.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
// COUNT: operation:operationAOTFillSiteCache = 0
"use strict";
const turns = +(process.argv[2] ?? 300);
class Fault extends Error { constructor(message, code) { super(message); this.code = code; } }
const fault = new Fault("went wrong", 7);
function read(e) { return e.code; }
let sum = 0;
for (let t = 0; t < turns; t++) sum += read(fault);
console.log("SAID", "error", sum, fault.message, fault.name, String(fault));
