const unseen = <T,>(v: T): T => [v][JSON.parse("0")];
const x: number = unseen(5), a: number = unseen(1), b: number = unseen(2), c: number = unseen(10);
const u: number | undefined = unseen(5);
const f = (v: number) => v || a + b as number * c;
console.log(f(5), f(0));
