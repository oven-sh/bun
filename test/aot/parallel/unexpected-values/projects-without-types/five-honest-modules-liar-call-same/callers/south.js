import { area, perimeter, scaled, widest } from "../measure.js";

export function south() {
  const box = { width: 2, height: 3 };
  return [area(box), perimeter(box), scaled(box, 2).width, widest([box, { width: 9, height: 1 }]).width];
}
