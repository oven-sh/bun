export enum A {
  X = 1,
  Y = X << 2,
}
export enum B {
  X = A.Y + 1,
  Y = A.X | X,
}
export enum C {
  X = B.Y * 2,
  Y = A.X + B.X,
}
export enum D {
  X = C.X + 1,
}
export enum Text {
  A = "a",
  B = `${A}b`,
  C = A + B,
}
