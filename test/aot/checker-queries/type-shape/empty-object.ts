// A type without members says nothing; an optional member is enough to be an object.
interface Empty {}
let v1: {};
let v2: Object;
let v3: Empty;
let v4: { a?: number };
export {};
