// The type of an object literal in a generic function is one type for each instantiation of the function: what the literal holds differs.
function box<T>(value: T) { return { value }; }
declare const n: number;
declare const s: string;
const v1 = box(n);
const v2 = box(s);
const v3 = box(n);
export {};
