// Enums: numbers, strings, const enums and the way back from a number to its name.
enum Color {
  Red,
  Green = 5,
  Blue,
}
enum Direction {
  Up = "UP",
  Down = "DOWN",
}
const enum Flags {
  None = 0,
  A = 1 << 0,
  B = 1 << 1,
  Both = A | B,
}
enum Computed {
  Length = "abc".length,
  Next = 4,
}
function name(color: Color): string {
  return Color[color];
}
console.log(Color.Red, Color.Blue, name(Color.Green), Direction.Down, Flags.Both, Computed.Next);
console.log(Object.keys(Color), Object.values(Direction));
namespace Geometry {
  export const origin = { x: 0, y: 0 };
  export function distance(x: number, y: number): number {
    return Math.hypot(x - origin.x, y - origin.y);
  }
}
console.log(Geometry.distance(3, 4));
