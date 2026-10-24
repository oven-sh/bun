// `o.id = 7` at the top level of a module, behind a conditional throw, is not lost when a loop below stores by computed keys.
const o = {};
if (!console) throw 0;
o.id = 7;
for (const k in {}) o[k] = 1;
console.log(o.id);
