// The order of union members does not change an identity. A union of other declarations is another union.
interface A { x: 1 }
interface B { y: 1 }
let v1: "a" | "b";
let v2: "b" | "a";
let v3: { k: A | B };
let v4: { k: B | A };
let v5: { x: 1 } | { y: 1 };
let v6: { y: 1 } | { x: 1 };
export {};
