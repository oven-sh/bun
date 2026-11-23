const unseen = <T,>(v: T): T => [v][JSON.parse("0")];
const a: number = unseen(1), b: number = unseen(2), c: number = unseen(10);
console.log(a + b as number * c);
