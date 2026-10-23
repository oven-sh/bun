// A discriminant property selects the union member that is the literal's contextual type.
type Shape = { kind: "a"; x: number } | { kind: "b"; y: string };
const s: Shape = { kind: "a", x: 1 };
export {};
