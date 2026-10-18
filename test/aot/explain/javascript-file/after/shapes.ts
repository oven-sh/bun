export interface Box {
  width: number;
  height: number;
}

export function area(box: Box): number {
  return box.width * box.height;
}
