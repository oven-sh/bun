// `o ? o : { m: () => 1 }` with `o: any`: a new function each time.
declare const console: { log(...a: unknown[]): void };
function look(o: any) { return (o ? o : { m: () => 1 }).m; }
console.log(look(0) === look(0));
