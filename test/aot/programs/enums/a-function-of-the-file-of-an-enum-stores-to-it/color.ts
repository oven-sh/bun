export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}
export function spoil() {
  (Color as any).Green = 9;
  const it: any = Color;
  it.Red = 8;
}
