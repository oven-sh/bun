// @ts-nocheck
import * as ns from "assigned-twice";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
