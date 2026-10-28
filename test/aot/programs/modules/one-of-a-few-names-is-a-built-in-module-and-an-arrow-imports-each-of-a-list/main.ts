const load = (n: string): any => import(n);
for (const n of ["fs", "./common.cjs"]) console.log(typeof (await load(n)));
export {};
