import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
const load = (n: string): any => r(n);
for (const n of ["fs", "./common.cjs"]) console.log(typeof load(n));
