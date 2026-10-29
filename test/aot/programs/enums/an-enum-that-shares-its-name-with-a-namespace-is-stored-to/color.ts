export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}
export namespace Color {
  export function spoil() {
    (Color as any).Green = 9;
  }
  export const extra = 1;
}
