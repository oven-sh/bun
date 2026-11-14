import { Shape, area, count } from "./shapes/lib.ts";
import { Named, areaOfNothing, callLoosely, keptShape, withoutSides } from "./calls/lib.ts";
import { keep, twice, word } from "./scripts/lib.ts";
class Square extends Named {
  describe(): string {
    return "square " + super.describe();
  }
}
const shapes: Shape[] = [new Shape("point"), new Shape("line", 2), new Named(), new Square(), withoutSides(), keptShape];
for (const shape of shapes) console.log(shape.describe(), Object.keys(shape).join());
console.log(count(shapes), area({ width: 3 }), area({ width: 3, height: 2 }), areaOfNothing());
console.log(callLoosely());
console.log(keep(5), word(), twice(4));
