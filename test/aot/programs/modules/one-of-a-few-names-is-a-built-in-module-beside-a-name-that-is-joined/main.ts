const load = (n: string): any => import.meta.require(n);
const name = ["./", "com", "mon.cjs"].join("");
for (const n of ["fs", name]) console.log(typeof load(n));
