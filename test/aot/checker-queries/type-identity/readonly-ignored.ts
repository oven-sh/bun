// `readonly` does not change the identity of an array type. Two type literals are two declarations, with `readonly` or without it.
let v1: { readonly a: number };
let v2: { a: number };
let v3: readonly number[];
let v4: number[];
export {};
