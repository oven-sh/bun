export namespace Wood {
  export interface Plank {
    width: number;
  }
  export const kind: string = "oak";
  export function double(width: number): number {
    return width * 2;
  }
}
export const count = 4;
