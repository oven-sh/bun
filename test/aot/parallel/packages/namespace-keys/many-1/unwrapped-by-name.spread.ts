// @ts-nocheck
import * as ns from "react";
console.log(Object.keys({ ...ns }).join(), Object.keys(Object.assign({}, ns)).join());
for (const k in ns) console.log(k);
