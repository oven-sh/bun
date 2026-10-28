const load = (n: string): any => import.meta.require(n);
for (const n of ["./common.cjs"]) console.log(typeof load(n));
