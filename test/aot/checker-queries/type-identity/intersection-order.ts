// An intersection is identified by its parts in the order in which they are written: `A & B` and `B & A` are two identities, and `A & B` written twice is one.
interface A { a: number }
interface B { b: string }
let v1: A & B;
let v2: B & A;
let v3: A & B;
export {};
