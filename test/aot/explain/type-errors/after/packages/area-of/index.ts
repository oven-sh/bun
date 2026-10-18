export interface Size {
  width: number;
  height: number;
}

export function areaOf(size: Size): number {
  const scale: number = 1;
  return size.width * size.height * Number(scale);
}
