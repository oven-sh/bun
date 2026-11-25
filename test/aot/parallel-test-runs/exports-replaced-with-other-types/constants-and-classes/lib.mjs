export const size = 4;
export const half = 0.5;
export const name = "lib";
export const point = { x: 1, y: 2 };
export const twice = n => n * 2;
export class Shape { area() { return size * size; } }
export default function main() { return size + 1; }
export function readAll() {
  return [size + 1, half + 0.5, name.length, point.x + point.y, twice(4), new Shape().area(), main()].join(" ");
}
