function load(n: string): any { return import.meta.require(n); }
for (const n of ["fs", "./common.cjs"]) console.log(typeof load(n));
