export enum Parts {
  A = 1,
}
export enum Parts {
  B = 2,
}
export enum Bits {
  A = 1 << 0,
  B = 1 << 1,
  C = A | B,
  D = C * 2 + 1,
  E = ~A,
  F = "x".length,
  G = Bits.C + 1,
}
export enum Late {
  A = process.argv.length,
  B = 4,
  C,
}
export const enum Fixed {
  A = 3,
  B = A * 2,
}
export enum Uses {
  Y = Fixed.B + 1,
}
