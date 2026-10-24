// An interface has one identity wherever it is named, at the top of an annotation or below a member. Two interfaces with the same members have two identities.
interface A { x: number }
interface B { x: number }
let v1: A;
let v2: B;
let v3: { p: A };
let v4: { p: B };
export {};
