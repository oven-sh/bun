import type { int32 } from "bun";

export class Point {
  x: int32 = 1;
  static count: int32 = 3;
}
export class Factory {
  get point(): Point {
    return new Point();
  }
  static get shared(): Point {
    return new Point();
  }
}
export function make(): Factory {
  return new Factory();
}
export const holder = {
  get point(): Point {
    return new Point();
  },
};
export default class Default {
  get point(): Point {
    return new Point();
  }
}
