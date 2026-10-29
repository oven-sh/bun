import { area, perimeter, scaled, widest } from "../measure.js";

export function east() {
  const box = { width: 3, height: 4 };
  return [area(box), perimeter(box), scaled(box, 2).width, widest([box, { width: 9, height: 1 }]).width];
}
