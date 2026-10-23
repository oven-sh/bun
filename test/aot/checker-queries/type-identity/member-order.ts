// Two type literals that list the same members in another order are two declarations with two orders of fields, so they have two identities.
let v1: { a: number; b: string };
let v2: { b: string; a: number };
export {};
