import { A, CA } from "./a";
export enum B {
  X = A.Y + 1,
  Y = CA.X + 1,
}
export const enum CB {
  X = CA.X + 1,
}
