// @ts-nocheck
import * as ns from "single-export";
console.log(JSON.stringify({ ...ns }), JSON.stringify(Object.assign({}, ns)));
for (const k in ns) console.log(k);
