import { area, perimeter, scaled, widest } from "../measure.js";

export function west() {
  const box = { width: 4, height: 5 };
  return [area(box), perimeter(box), scaled(box, 2).width, widest([box, { width: 9, height: 1 }]).width];
}
