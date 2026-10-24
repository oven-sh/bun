// The compiler knows a function type by the declaration of its signature. Two that are written alike are two types, and so are the tuples that hold them. One declaration has one identity wherever it is named.
type F = () => number;
let v1: () => number;
let v2: () => number;
let v3: F;
let v4: F;
let v5: [F];
let v6: [F];
let v7: [() => number];
export {};
