"use strict";
interface Point {
  x: number;
  y?: number;
}
const frozen = Object.freeze({ x: 1 }) as unknown as Point;
const sealed = Object.seal({ x: 2 }) as unknown as Point;
const closed = Object.preventExtensions({ x: 3 }) as unknown as Point;
function attempt(point: Point) {
  const outcome: string[] = [];
  for (const store of [() => void (point.x = 9), () => void (point.y = 8), () => void delete (point as { x?: number }).x]) {
    try {
      store();
      outcome.push("fine");
    } catch (error) {
      outcome.push((error as Error).constructor.name);
    }
  }
  return outcome.join() + ":" + JSON.stringify(point) + ":" + point.y;
}
console.log(attempt(frozen), Object.isFrozen(frozen));
console.log(attempt(sealed), Object.isSealed(sealed), Object.isFrozen(sealed));
console.log(attempt(closed), Object.isExtensible(closed));
