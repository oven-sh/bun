// The checker has reduced a union with `unknown` or `any` to that before anybody asks.
let v1: unknown | string;
let v2: any | string;
let v3: unknown | { a: number } | undefined;
export {};
