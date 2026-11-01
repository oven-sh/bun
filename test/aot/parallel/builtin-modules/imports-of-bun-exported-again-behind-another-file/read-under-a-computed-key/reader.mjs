import * as front from "./front.mjs";
for (const key of ["bun", "other"]) console.log(key, front[key] === Bun);
