import { area, perimeter, scaled, widest } from "../measure.js";

export function north() {
  const box = { width: 1, height: 2 };
  return [area(box), perimeter(box), scaled(box, 2).width, widest([box, { width: 9, height: 1 }]).width];
}
