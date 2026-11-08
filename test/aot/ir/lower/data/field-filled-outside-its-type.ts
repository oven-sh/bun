// RUN: link
// CHECK: layout [[point]] {{*}}{key="x" declared={type=number flags=[IsExpected]} flags=[IsRequired]}, {key="y" declared={type=number} flags=[IsRequired]}]
// CHECK: layout [[size]] {{*}}{key="height" declared={type=number} flags=[IsRequired]}, {key="width" declared={type=number} flags=[IsRequired]}]

interface Point {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}
export const point: Point = { x: undefined!, y: 1 };
export const size: Size = { width: 2, height: 3 };
