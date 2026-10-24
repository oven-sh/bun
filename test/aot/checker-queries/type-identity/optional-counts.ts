// A type literal with an optional member and one with a required member are two declarations, so they have two identities.
let v1: { a?: number };
let v2: { a: number };
export {};
