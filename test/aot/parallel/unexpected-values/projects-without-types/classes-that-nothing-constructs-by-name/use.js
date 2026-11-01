export const describe = shape => shape.describe();
export const sides = shape => shape.sides + 1;
export const area = shape => shape.area();
export const extra = shape => shape.extra;
export const keys = shape => Object.keys(shape).join();
