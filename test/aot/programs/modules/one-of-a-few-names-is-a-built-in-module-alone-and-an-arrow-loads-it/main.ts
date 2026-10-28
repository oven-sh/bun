const load = (n: string): any => import.meta.require(n);
console.log(typeof load("fs"));
