export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}
export function spoil(text: string) {
  eval(text);
}
