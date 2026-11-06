namespace Shapes {
  export interface Point { x: number; y: number }
  export const origin: Point = { x: 0.5, y: 1.5 };
}
console.log(Shapes.origin.x + Shapes.origin.y);
export {};
