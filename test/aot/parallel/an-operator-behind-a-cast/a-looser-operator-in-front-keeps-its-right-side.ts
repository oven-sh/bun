const unseen = <T,>(v: T): T => [v][JSON.parse("0")];
const x: number = unseen(5);
const a: number = unseen(1);
const b: number = unseen(2);
const c: number = unseen(10);
console.log(x || a + b as number * c);
console.log(x || a * b as number ** c);
console.log(x | a + b as number * c);
console.log(x ^ a - b satisfies number * c);
