import { area, perimeter, scaled, widest } from "../measure.js";

export function center() {
  const box = { width: 5, height: 6 };
  return [area(box), perimeter(box), scaled(box, 2).width, widest([box, { width: 9, height: 1 }]).width];
}
