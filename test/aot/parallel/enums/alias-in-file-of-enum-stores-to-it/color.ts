export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}
import Alias = Color;
export function spoil() {
  (Alias as any).Green = 9;
}
