// An object literal typed by a union without a discriminant has no contextual type.
type U = { x: number } | { y: string };
const u: U = { x: 1 };
export {};
