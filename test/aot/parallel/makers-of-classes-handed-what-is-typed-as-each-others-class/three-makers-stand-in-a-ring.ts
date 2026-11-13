function first(B: new () => object) { return class First extends B { a = 1; one() { return "one" + this.a; } }; }
function second(B: new () => object) { return class Second extends B { b = 2; two() { return "two" + this.b; } }; }
function third(B: new () => object) { return class Third extends B { c = 3; three() { return "three" + this.c; } }; }
let last = Object as unknown as ReturnType<typeof third>;
const One = first(last), Two = second(One); last = third(Two);
const made = new last() as any;
(One as any).mark = "m"; (Two as any).mark = "n";
console.log(made.one(), made.two(), made.three(), Object.keys(made).join(), (last as any).mark, (One as any).mark);
console.log(made instanceof One, made instanceof Two, new One() instanceof last, "three" in new One());
export {};
