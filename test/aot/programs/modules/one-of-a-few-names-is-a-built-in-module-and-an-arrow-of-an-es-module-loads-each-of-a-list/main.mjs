const load = n => import.meta.require(n);
for (const n of ["fs", "./common.cjs"]) console.log(typeof load(n));
