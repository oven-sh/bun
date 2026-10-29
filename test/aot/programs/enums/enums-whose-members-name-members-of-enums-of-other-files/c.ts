import { B, CB } from "./b";
export enum C {
  X = B.X + 1,
  Y = CB.X + 1,
  Z = B.Y + 1,
}
