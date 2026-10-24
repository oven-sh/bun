// Enum members keep their values; an enum with a computed member is not a union.
enum Direction { Up, Down }
enum Name { A = "a" }
enum Computed { A = "ab".length }
let v1: Direction.Down;
let v2: Name.A;
let v3: Direction;
let v4: Computed;
export {};
