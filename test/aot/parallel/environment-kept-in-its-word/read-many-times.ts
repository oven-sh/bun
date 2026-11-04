// read many times
let n = 0;
for (let i = 0; i < 1000; i++) if (process.env.NOBODY_SETS_THIS === undefined && Bun.env.NOBODY_SETS_THIS === undefined) n++;
console.log(n, process.env === Bun.env, process.env === process.env);
