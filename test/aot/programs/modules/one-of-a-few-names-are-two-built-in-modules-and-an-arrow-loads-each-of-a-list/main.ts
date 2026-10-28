const load = (n: string): any => import.meta.require(n);
for (const n of ["fs", "node:path"]) console.log(typeof load(n));
